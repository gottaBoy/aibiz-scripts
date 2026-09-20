import java.io.IOException;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.atomic.AtomicInteger;

import liquibase.changelog.ChangeLogParameters;
import liquibase.changelog.DatabaseChangeLog;
import liquibase.exception.ChangeLogParseException;
import liquibase.parser.core.xml.XMLChangeLogSAXParser;
import liquibase.resource.ClassLoaderResourceAccessor;
import liquibase.resource.CompositeResourceAccessor;
import liquibase.resource.FileSystemResourceAccessor;

// Parse only: no database connection, migration, or modification of supplied XML.
class LiquibaseOfflineCheck {
    private static DatabaseChangeLog parse(Path file) throws Exception {
        return new XMLChangeLogSAXParser().parse(
            file.getFileName().toString(), new ChangeLogParameters(),
            new CompositeResourceAccessor(
                new FileSystemResourceAccessor(file.toAbsolutePath().getParent().toString()),
                new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader())));
    }

    public static void main(String[] args) throws Exception {
        AtomicInteger networkAttempts = new AtomicInteger();
        URL.setURLStreamHandlerFactory(protocol -> {
            if (!protocol.equals("http") && !protocol.equals("https")) return null;
            return new URLStreamHandler() {
                @Override
                protected URLConnection openConnection(URL url) throws IOException {
                    networkAttempts.incrementAndGet();
                    throw new IOException("External schema access is forbidden by this offline check");
                }
            };
        });
        Path temp = Files.createTempDirectory("liquibase-offline-");
        try {
            String header = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<databaseChangeLog xmlns=\"http://www.liquibase.org/xml/ns/dbchangelog\""
                + " xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\""
                + " xsi:schemaLocation=\"http://www.liquibase.org/xml/ns/dbchangelog"
                + " http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.6.xsd\">";
            Path valid = temp.resolve("valid.xml");
            Files.writeString(valid, header + "<changeSet id=\"offline-check\" author=\"harness\">"
                + "<createTable tableName=\"offline_only\"><column name=\"id\" type=\"BIGINT\"/>"
                + "</createTable></changeSet></databaseChangeLog>");
            if (parse(valid).getChangeSets().size() != 1) {
                throw new AssertionError("Valid change set was not parsed");
            }
            Path invalid = temp.resolve("invalid.xml");
            Files.writeString(invalid, header + "<notALiquibaseChange/></databaseChangeLog>");
            try {
                parse(invalid);
                throw new AssertionError("Invalid schema content was accepted");
            } catch (ChangeLogParseException expected) {
                System.out.println("PASS invalid schema content rejected");
            }
            for (String arg : args) {
                Path file = Path.of(arg);
                DatabaseChangeLog changeLog = parse(file);
                System.out.println("PASS changelog " + file.getFileName()
                    + " changeSets=" + changeLog.getChangeSets().size());
            }
            if (networkAttempts.get() != 0) {
                throw new AssertionError("External schema requests: " + networkAttempts.get());
            }
            System.out.println("PASS offline 4.6 XSD validation; external requests=0; database writes=0");
        } finally {
            try (var files = Files.walk(temp)) {
                for (Path file : files.sorted(Comparator.reverseOrder()).toArray(Path[]::new)) {
                    Files.delete(file);
                }
            }
        }
    }
}
