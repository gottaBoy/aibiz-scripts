import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

public final class PrepareRuntimeArchiveOverlay {
    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
    }

    private static String sha(byte[] bytes) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes)) {
            result.append(String.format("%02x", value & 255));
        }
        return result.toString();
    }

    private static byte[] read(ZipFile zip, ZipEntry entry) throws Exception {
        try (InputStream input = zip.getInputStream(entry)) {
            return input.readAllBytes();
        }
    }

    private static List<ZipEntry> entries(ZipFile zip) {
        List<ZipEntry> result = new ArrayList<>();
        Set<String> names = new HashSet<>();
        Enumeration<? extends ZipEntry> all = zip.entries();
        while (all.hasMoreElements()) {
            ZipEntry entry = all.nextElement();
            if (!names.add(entry.getName())) throw new IllegalArgumentException("Duplicate archive entry");
            if (entry.getName().matches("(?i)META-INF/[^/]+\\.(SF|RSA|DSA|EC)")) {
                throw new IllegalArgumentException("Signed archive requires a separate signing plan");
            }
            result.add(entry);
        }
        return result;
    }

    private static void privateFile(Path file) throws Exception {
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
    }

    private static void extract(Path archive, Path output) throws Exception {
        List<String> rows = new ArrayList<>();
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            for (ZipEntry entry : entries(zip)) {
                if (!entry.getName().startsWith("BOOT-INF/lib/") || !entry.getName().endsWith(".jar")) continue;
                if (!entry.getName().matches("BOOT-INF/lib/[A-Za-z0-9_.+\\-]+\\.jar")
                    || entry.getMethod() != ZipEntry.STORED) {
                    throw new IllegalArgumentException("Unreviewed nested archive layout");
                }
                byte[] bytes = read(zip, entry);
                Path file = output.resolve(entry.getName().substring("BOOT-INF/lib/".length()));
                Files.write(file, bytes, StandardOpenOption.CREATE_NEW);
                privateFile(file);
                rows.add("{\"entry\":" + quote(entry.getName()) + ",\"file\":" + quote(file.toString())
                    + ",\"sha256\":" + quote(sha(bytes)) + ",\"bytes\":" + bytes.length + "}");
            }
        }
        System.out.println("{\"dependencies\":[" + String.join(",", rows) + "]}");
    }

    private static ZipEntry metadata(ZipEntry old, byte[] bytes) {
        ZipEntry result = new ZipEntry(old.getName());
        result.setMethod(old.getMethod());
        if (old.getTime() >= 0) result.setTime(old.getTime());
        if (old.getComment() != null) result.setComment(old.getComment());
        if (old.getExtra() != null) result.setExtra(old.getExtra());
        if (result.getMethod() == ZipEntry.STORED) {
            CRC32 crc = new CRC32();
            crc.update(bytes);
            result.setSize(bytes.length);
            result.setCompressedSize(bytes.length);
            result.setCrc(crc.getValue());
        }
        return result;
    }

    private static void write(ZipOutputStream output, ZipEntry entry, byte[] bytes) throws Exception {
        output.putNextEntry(metadata(entry, bytes));
        output.write(bytes);
        output.closeEntry();
    }

    private static Map<String, String> hashes(Path file) throws Exception {
        Map<String, String> result = new LinkedHashMap<>();
        try (ZipFile zip = new ZipFile(file.toFile())) {
            for (ZipEntry entry : entries(zip)) result.put(entry.getName(), sha(read(zip, entry)));
        }
        return result;
    }

    private static int major(byte[] bytes) {
        if (bytes.length < 8 || bytes[0] != (byte) 0xca || bytes[1] != (byte) 0xfe
            || bytes[2] != (byte) 0xba || bytes[3] != (byte) 0xbe) {
            throw new IllegalArgumentException("Invalid class bytes");
        }
        return ((bytes[6] & 255) << 8) | (bytes[7] & 255);
    }

    private static void overlay(Path archive, Path output, Map<String, Path> replacements) throws Exception {
        if (replacements.isEmpty()) throw new IllegalArgumentException("An explicit overlay is required");
        Map<String, String> before = hashes(archive);
        Set<String> copied = new HashSet<>();
        Set<Integer> classVersions = new HashSet<>();
        try (ZipFile zip = new ZipFile(archive.toFile());
             OutputStream file = Files.newOutputStream(output, StandardOpenOption.CREATE_NEW);
             ZipOutputStream target = new ZipOutputStream(file)) {
            if (zip.getComment() != null) target.setComment(zip.getComment());
            for (ZipEntry entry : entries(zip)) {
                byte[] original = read(zip, entry);
                byte[] bytes = replacements.containsKey(entry.getName())
                    ? Files.readAllBytes(replacements.get(entry.getName())) : original;
                if (replacements.containsKey(entry.getName())) {
                    copied.add(entry.getName());
                    if (sha(original).equals(sha(bytes))) throw new IllegalArgumentException("Unchanged overlay target");
                    if (entry.getName().endsWith(".class") && major(original) != major(bytes)) {
                        throw new IllegalArgumentException("Class version changed");
                    }
                    if (entry.getName().endsWith(".class")) classVersions.add(major(original));
                }
                write(target, entry, bytes);
            }
            for (Map.Entry<String, Path> item : replacements.entrySet()) {
                if (copied.contains(item.getKey())) continue;
                if (!item.getKey().endsWith(".class")) throw new IllegalArgumentException("Only classes may be added");
                byte[] bytes = Files.readAllBytes(item.getValue());
                if (classVersions.size() != 1 || !classVersions.contains(major(bytes))) {
                    throw new IllegalArgumentException("New class must match the replaced module class version");
                }
                ZipEntry entry = new ZipEntry(item.getKey());
                entry.setMethod(ZipEntry.DEFLATED);
                entry.setTime(0);
                write(target, entry, bytes);
            }
        }
        privateFile(output);
        Map<String, String> after = hashes(output);
        List<String> rows = new ArrayList<>();
        for (Map.Entry<String, String> item : before.entrySet()) {
            String current = after.get(item.getKey());
            boolean changed = !item.getValue().equals(current);
            if (changed && !replacements.containsKey(item.getKey())) {
                throw new IllegalArgumentException("Unrelated archive content changed");
            }
            rows.add("{\"entry\":" + quote(item.getKey()) + ",\"beforeSha256\":" + quote(item.getValue())
                + ",\"afterSha256\":" + quote(current) + ",\"changed\":" + changed + ",\"added\":false}");
        }
        for (String name : replacements.keySet()) {
            if (!before.containsKey(name)) rows.add("{\"entry\":" + quote(name)
                + ",\"afterSha256\":" + quote(after.get(name)) + ",\"changed\":true,\"added\":true}");
        }
        if (after.size() != before.size() + replacements.keySet().stream().filter(name -> !before.containsKey(name)).count()) {
            throw new IllegalArgumentException("Unexpected archive entries");
        }
        System.out.println("{\"entries\":[" + String.join(",", rows) + "]}");
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 3 && args[0].equals("extract")) {
            extract(Path.of(args[1]), Path.of(args[2]));
        } else if (args.length >= 4 && args[0].equals("overlay")) {
            Map<String, Path> replacements = new LinkedHashMap<>();
            for (int index = 3; index < args.length; index++) {
                int separator = args[index].indexOf('=');
                if (separator < 1) throw new IllegalArgumentException("An entry=file pair is required");
                String entry = args[index].substring(0, separator);
                if (!entry.matches("[A-Za-z0-9_.$+/-]+\\.(class|jar)") || entry.contains("..")) {
                    throw new IllegalArgumentException("Unsafe overlay entry");
                }
                if (replacements.put(entry, Path.of(args[index].substring(separator + 1))) != null) {
                    throw new IllegalArgumentException("Duplicate overlay target");
                }
            }
            overlay(Path.of(args[1]), Path.of(args[2]), replacements);
        } else throw new IllegalArgumentException("Use extract or overlay");
    }
}
