import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.PrintStream;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import net.ibizsys.central.ISystemRuntime;
import net.ibizsys.central.cloud.core.spring.rt.ServiceHub;
import net.ibizsys.central.cloud.core.util.domain.DataSource;
import net.ibizsys.central.database.ISysDBSchemeRuntime;
import net.ibizsys.central.database.mysql.MySQL5Dialect;
import net.ibizsys.central.plugin.liquibase.spring.LiquibaseTool;
import net.ibizsys.model.PSModelEnums.DBObjNameCaseMode;
import net.ibizsys.model.PSModelServiceImpl;
import net.ibizsys.model.database.IPSSysDBScheme;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;

/** Runs the packaged extension model and source operator query without granting UAA passwords. */
public final class OwnedPlatformSchemaProbe {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> COLUMNLESS = Arrays.asList(
        "SYSTEM_EXTENSION_MAINSTATE", "SYSTEM_EXTENSION_SCHEDULE_TASK");

    private static String sha(byte[] bytes) throws Exception {
        StringBuilder value = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) {
            value.append(String.format("%02x", b & 255));
        }
        return value.toString();
    }

    private static Map<String, ObjectNode> byName(JsonNode values) {
        Map<String, ObjectNode> result = new LinkedHashMap<>();
        if (!values.isArray()) throw new IllegalStateException("Missing model inventory");
        for (JsonNode value : values) {
            String name = value.path("name").asText();
            if (!name.matches("[A-Za-z][A-Za-z0-9_]*") || result.put(name, (ObjectNode) value) != null) {
                throw new IllegalArgumentException("Unsafe or duplicate physical model name");
            }
        }
        return result;
    }

    private static ObjectNode model(Map<String, Object> result) throws Exception {
        byte[] bytes = org.apache.commons.io.IOUtils.toByteArray(
            OwnedPlatformSchemaProbe.class.getResourceAsStream(
                "/sysmodel/saas-extension/PSSYSDBSCHEMES/DEFAULT.json"));
        ObjectNode model = (ObjectNode) JSON.readTree(bytes);
        Map<String, ObjectNode> inventory = byName(model.path("getAllPSSysDBTables"));
        if (inventory.size() != 34) throw new IllegalStateException("Extension model inventory drift");
        List<String> skipped = new ArrayList<>();
        int physical = 0;
        for (ObjectNode table : inventory.values()) {
            JsonNode columns = table.path("getAllPSSysDBColumns");
            if (columns.isMissingNode()) {
                if (!table.path("autoExtendModel").asBoolean() || table.path("existingModel").asBoolean()) {
                    throw new IllegalStateException("Unreviewed columnless table");
                }
                skipped.add(table.path("name").asText());
            } else {
                if (byName(columns).isEmpty()) throw new IllegalStateException("Empty physical table");
                physical++;
            }
        }
        Collections.sort(skipped);
        if (physical != 32 || !skipped.equals(COLUMNLESS)) {
            throw new IllegalStateException("Extension physical/columnless inventory drift");
        }
        result.put("modelSha256", sha(bytes));
        result.put("columnlessModelEntries", skipped);
        return model;
    }

    private static Object context(Class<?> type, Map<String, Object> methods) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (proxy, method, args) -> {
            if (methods.containsKey(method.getName())) return methods.get(method.getName());
            if ("toString".equals(method.getName())) return "OwnedPlatformFixtureContext";
            throw new UnsupportedOperationException("Unreviewed adapter context: " + method.getName());
        });
    }

    private static void denied(Connection connection, String sql, int... codes) throws Exception {
        try (java.sql.Statement statement = connection.createStatement()) {
            try {
                statement.execute(sql);
                throw new IllegalStateException("Runtime operation unexpectedly allowed");
            } catch (SQLException error) {
                for (int code : codes) if (error.getErrorCode() == code) return;
                throw error;
            }
        }
    }

    private static void structure(Connection connection, ObjectNode model, Map<String, Object> result) throws Exception {
        DatabaseMetaData metadata = connection.getMetaData();
        List<String> expectedTables = new ArrayList<>();
        int columnCount = 0;
        int indexCount = 0;
        for (ObjectNode table : byName(model.path("getAllPSSysDBTables")).values()) {
            if (!table.has("getAllPSSysDBColumns")) continue;
            String name = table.path("name").asText().toLowerCase(java.util.Locale.ROOT);
            expectedTables.add(table.path("name").asText());
            Map<String, Integer> columns = new TreeMap<>();
            try (ResultSet rows = metadata.getColumns(connection.getCatalog(), null, name, null)) {
                while (rows.next()) columns.put(rows.getString("COLUMN_NAME").toUpperCase(java.util.Locale.ROOT),
                    rows.getInt("COLUMN_SIZE"));
            }
            Map<String, ObjectNode> wanted = byName(table.path("getAllPSSysDBColumns"));
            if (!columns.keySet().equals(wanted.keySet())) throw new IllegalStateException("Column set differs: " + name);
            List<String> expectedKeys = new ArrayList<>();
            for (ObjectNode column : wanted.values()) {
                if (column.path("pKey").asBoolean()) expectedKeys.add(column.path("name").asText());
                if (column.path("stdDataType").asInt() == 25
                    && columns.get(column.path("name").asText()) < column.path("length").asInt()) {
                    throw new IllegalStateException("String capacity too small: " + name);
                }
            }
            List<String> keys = new ArrayList<>();
            try (ResultSet rows = metadata.getPrimaryKeys(connection.getCatalog(), null, name)) {
                while (rows.next()) keys.add(rows.getString("COLUMN_NAME").toUpperCase(java.util.Locale.ROOT));
            }
            Collections.sort(keys);
            Collections.sort(expectedKeys);
            if (!keys.equals(expectedKeys)) throw new IllegalStateException("Primary key differs: " + name);
            Map<String, List<String>> indices = new TreeMap<>();
            try (ResultSet rows = metadata.getIndexInfo(connection.getCatalog(), null, name, false, false)) {
                while (rows.next()) {
                    String index = rows.getString("INDEX_NAME");
                    String column = rows.getString("COLUMN_NAME");
                    if (index != null && column != null) indices.computeIfAbsent(index.toLowerCase(java.util.Locale.ROOT),
                        ignored -> new ArrayList<>()).add(column.toUpperCase(java.util.Locale.ROOT));
                }
            }
            for (JsonNode index : table.path("getAllPSSysDBIndices")) {
                List<String> names = new ArrayList<>();
                for (JsonNode column : index.path("getAllPSSysDBIndexColumns")) names.add(column.path("name").asText());
                if (!names.equals(indices.get(index.path("codeName").asText().toLowerCase(java.util.Locale.ROOT)))) {
                    throw new IllegalStateException("Index differs: " + name);
                }
                indexCount++;
            }
            columnCount += columns.size();
        }
        List<String> observed = new ArrayList<>();
        try (ResultSet rows = metadata.getTables(connection.getCatalog(), null, "%", new String[] {"TABLE"})) {
            while (rows.next()) {
                String name = rows.getString("TABLE_NAME").toUpperCase(java.util.Locale.ROOT);
                if (!"DATABASECHANGELOG".equals(name) && !"DATABASECHANGELOGLOCK".equals(name)) observed.add(name);
            }
        }
        Collections.sort(observed);
        Collections.sort(expectedTables);
        if (!observed.equals(expectedTables)) throw new IllegalStateException("Unexpected or missing platform tables");
        result.put("tables", expectedTables);
        result.put("columnsVerified", columnCount);
        result.put("indicesVerified", indexCount);
        result.put("primaryKeysVerified", true);
    }

    private static void projection(Map<String, String> input, Map<String, Object> result) throws Exception {
        String run = input.get("runId");
        String url = "jdbc:mysql://nf-" + run + "-mysql:3306/nf_" + run
            + "_ebsx?useUnicode=true&characterEncoding=UTF-8&useSSL=false";
        if (!url.equals(input.get("projectionUrl")) || !("nf_" + run + "_ebsx_app").equals(input.get("projectionUsername"))
            || input.get("projectionPassword") == null || !input.get("projectionPassword").matches("[a-f0-9]{36}")) {
            throw new IllegalArgumentException("Foreign projection datasource");
        }
        byte[] queryBytes = Files.readAllBytes(Paths.get("/inputs/employee-default.json"));
        JsonNode query = JSON.readTree(queryBytes);
        String sql = query.path("queryCode").asText();
        if (!sql.startsWith("SELECT\n") || !sql.contains("t1.USER_PASSWORD as PASSWORD")
            || !sql.contains("FROM sys_person t1 left join sys_organization o")
            || !sql.contains("left join sys_department d")) throw new IllegalStateException("Operator query drift");
        List<Map<String, Object>> users = new ArrayList<>();
        boolean valuesReady = true;
        try (Connection connection = DriverManager.getConnection(url, input.get("projectionUsername"),
                input.get("projectionPassword"))) {
            for (String table : new String[] {"sys_person", "sys_organization", "sys_department"}) {
                denied(connection, "UPDATE " + table + " SET ID=ID WHERE 1=0", 1288);
                denied(connection, "DELETE FROM " + table + " WHERE 1=0", 1288);
                denied(connection, "INSERT INTO " + table + " (ID) SELECT ID FROM " + table + " WHERE 1=0", 1471);
            }
            denied(connection, "SELECT USER_PASSWORD FROM nf_" + run + "_uaa.sys_person", 1142);
            try (java.sql.Statement statement = connection.createStatement();
                 ResultSet rows = statement.executeQuery("SELECT * FROM (" + sql + ") owned_operator ORDER BY USERID")) {
                while (rows.next()) {
                    if (rows.getObject("PASSWORD") != null) throw new IllegalStateException("Password exposed by operator query");
                    Map<String, Object> user = new LinkedHashMap<>();
                    user.put("personId", rows.getString("USERID"));
                    user.put("centerId", rows.getString("SRFDCID"));
                    user.put("displayName", rows.getString("PERSONNAME"));
                    user.put("loginname", rows.getString("LOGINNAME"));
                    String value = rows.getString("USERCODE");
                    user.put("operatorValuePresent", value != null && !value.isEmpty());
                    valuesReady &= value != null && !value.isEmpty();
                    users.add(user);
                }
            }
        }
        result.put("operatorQuerySha256", sha(queryBytes));
        result.put("operatorUsers", users);
        result.put("operatorValuesReady", valuesReady);
        result.put("operatorPasswordMasked", true);
        result.put("projectionDmlDenied", true);
        result.put("uaaDirectReadDenied", true);
    }

    public static void main(String[] args) throws Throwable {
        Map<String, String> input = JSON.readValue(System.in, new TypeReference<Map<String, String>>() {});
        String run = input.get("runId");
        String mode = input.get("mode");
        if (run == null || !run.matches("[a-f0-9]{12}")
            || !("bootstrap".equals(mode) || "verify".equals(mode))) {
            throw new IllegalArgumentException("Explicit owned platform fixture required");
        }
        String schema = "nf_" + run + "_platform";
        String user = "nf_" + run + ("bootstrap".equals(mode) ? "_plat_ddl" : "_plat_app");
        String url = "jdbc:mysql://nf-" + run + "-mysql:3306/" + schema
            + "?useUnicode=true&characterEncoding=UTF-8&useSSL=false";
        if (!url.equals(input.get("url")) || !user.equals(input.get("username"))
            || input.get("password") == null || !input.get("password").matches("[a-f0-9]{36}")) {
            throw new IllegalArgumentException("Foreign platform datasource");
        }
        PrintStream output = System.out;
        System.setOut(System.err);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", mode);
        ObjectNode physicalModel = model(result);
        PSModelServiceImpl service = new PSModelServiceImpl();
        service.setPSModelFolderPath("/sysmodel/saas-extension", true);
        IPSSysDBScheme scheme = service.getPSModelObject(null, IPSSysDBScheme.class, physicalModel, null);
        if ("bootstrap".equals(mode)) {
            new ServiceHub();
            Map<String, Object> systemMethods = new LinkedHashMap<>();
            systemMethods.put("getFileFolder", "/tmp/platform-model");
            systemMethods.put("getDeploySystemId", "extension");
            systemMethods.put("getPSSystemService", service);
            ISystemRuntime system = (ISystemRuntime) context(ISystemRuntime.class, systemMethods);
            Map<String, Object> schemaMethods = new LinkedHashMap<>();
            schemaMethods.put("getPSSysDBScheme", scheme);
            schemaMethods.put("getDBDialect", new MySQL5Dialect());
            schemaMethods.put("getDBObjNameCaseMode", DBObjNameCaseMode.LCASE);
            schemaMethods.put("getDSLink", "DEFAULT");
            schemaMethods.put("isDropIndexFirst", false);
            schemaMethods.put("getSystemRuntime", system);
            ISysDBSchemeRuntime runtime = (ISysDBSchemeRuntime) context(ISysDBSchemeRuntime.class, schemaMethods);
            LiquibaseTool adapter = new LiquibaseTool() {
                @Override
                protected Database createDatabaseObject(DataSource descriptor) throws Exception {
                    return DatabaseFactory.getInstance().findCorrectDatabaseImplementation(
                        new JdbcConnection(DriverManager.getConnection(url, user, input.get("password"))));
                }
            };
            adapter.sync(system, runtime, new DataSource(), null);
            adapter.sync(system, runtime, new DataSource(), null);
            result.put("adapterReplayPassed", true);
        }
        try (Connection connection = DriverManager.getConnection(url, user, input.get("password"))) {
            structure(connection, physicalModel, result);
            if ("verify".equals(mode)) {
                String id = "nf_" + run + "_platform_probe";
                try (PreparedStatement create = connection.prepareStatement(
                        "INSERT INTO internal_message (ID, TITLE, RECEIVER, STATUS) VALUES (?, ?, ?, ?)")) {
                    create.setString(1, id); create.setString(2, "owned-before");
                    create.setString(3, "owned-receiver"); create.setString(4, "0");
                    if (create.executeUpdate() != 1) throw new IllegalStateException("Platform create failed");
                }
                try {
                    try (PreparedStatement update = connection.prepareStatement("UPDATE internal_message SET TITLE=? WHERE ID=?")) {
                        update.setString(1, "owned-after"); update.setString(2, id);
                        if (update.executeUpdate() != 1) throw new IllegalStateException("Platform update failed");
                    }
                    try (PreparedStatement read = connection.prepareStatement("SELECT TITLE FROM internal_message WHERE ID=?")) {
                        read.setString(1, id);
                        try (ResultSet rows = read.executeQuery()) {
                            if (!rows.next() || !"owned-after".equals(rows.getString(1))) {
                                throw new IllegalStateException("Platform readback failed");
                            }
                        }
                    }
                } finally {
                    try (PreparedStatement remove = connection.prepareStatement("DELETE FROM internal_message WHERE ID=?")) {
                        remove.setString(1, id);
                        if (remove.executeUpdate() != 1) throw new IllegalStateException("Platform removal failed");
                    }
                }
                try (PreparedStatement read = connection.prepareStatement("SELECT COUNT(*) FROM internal_message WHERE ID=?")) {
                    read.setString(1, id);
                    try (ResultSet rows = read.executeQuery()) {
                        if (!rows.next() || rows.getInt(1) != 0) throw new IllegalStateException("Platform probe retained");
                    }
                }
                denied(connection, "CREATE TABLE owned_platform_ddl_probe (ID INT)", 1142);
                denied(connection, "SELECT USER_PASSWORD FROM nf_" + run + "_uaa.sys_person", 1142);
                result.put("crudVerified", true);
                result.put("runtimeDdlDenied", true);
                result.put("probeRemoved", true);
                projection(input, result);
            }
            try (java.sql.Statement statement = connection.createStatement();
                 ResultSet rows = statement.executeQuery("SELECT DATABASE(), CURRENT_USER()")) {
                rows.next();
                result.put("schema", rows.getString(1));
                result.put("sqlPrincipal", rows.getString(2));
            }
        }
        result.put("adapterOrigin", LiquibaseTool.class.getProtectionDomain().getCodeSource().getLocation().toString());
        output.println(JSON.writeValueAsString(result));
    }
}
