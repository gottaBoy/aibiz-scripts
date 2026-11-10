import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.PrintStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
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

/** Uses the packaged model and Liquibase adapter; only JDBC/context plumbing is fixture-specific. */
public final class OwnedEbsxSchemaProbe {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static String sha(byte[] bytes) throws Exception {
        StringBuilder value = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) {
            value.append(String.format("%02x", b & 255));
        }
        return value.toString();
    }

    private static Map<String, ObjectNode> byName(ArrayNode values) {
        Map<String, ObjectNode> result = new LinkedHashMap<>();
        for (JsonNode value : values) {
            String name = value.path("name").asText();
            if (!name.matches("[A-Za-z][A-Za-z0-9_]*") || result.put(name, (ObjectNode) value) != null) {
                throw new IllegalArgumentException("Unsafe or duplicate physical model name");
            }
        }
        return result;
    }

    private static ObjectNode mergedModel(Map<String, Object> evidence) throws Exception {
        Map<String, ObjectNode> models = new LinkedHashMap<>();
        Map<String, String> hashes = new LinkedHashMap<>();
        for (String link : new String[] {"DEFAULT", "DB2", "DB3"}) {
            String path = "/sysmodel/saas-ebsx/PSSYSDBSCHEMES/" + link + ".json";
            byte[] bytes = org.apache.commons.io.IOUtils.toByteArray(
                OwnedEbsxSchemaProbe.class.getResourceAsStream(path));
            hashes.put(link, sha(bytes));
            models.put(link, (ObjectNode) JSON.readTree(bytes));
        }
        ObjectNode merged = models.get("DEFAULT").deepCopy();
        merged.remove("dynaModelFilePath");
        Map<String, ObjectNode> tables = byName((ArrayNode) merged.get("getAllPSSysDBTables"));
        if (tables.size() != 78) throw new IllegalStateException("EBSX DEFAULT table inventory drift");
        List<Map<String, Object>> adaptations = new ArrayList<>();
        for (String link : new String[] {"DB2", "DB3"}) {
            for (ObjectNode projection : byName((ArrayNode) models.get(link).get("getAllPSSysDBTables")).values()) {
                ObjectNode target = tables.get(projection.path("name").asText());
                if (target == null) throw new IllegalStateException("Projection introduces an unknown physical table");
                Map<String, ObjectNode> columns = byName((ArrayNode) target.get("getAllPSSysDBColumns"));
                ArrayNode projectedColumns = (ArrayNode) projection.get("getAllPSSysDBColumns");
                if (projectedColumns != null) for (ObjectNode column : byName(projectedColumns).values()) {
                    ObjectNode original = columns.get(column.path("name").asText());
                    if (original == null) throw new IllegalStateException("Projection introduces an unknown column");
                    for (String key : new String[] {"stdDataType", "pKey", "nullable", "autoIncrement", "dataType"}) {
                        if (!original.path(key).equals(column.path(key))) {
                            throw new IllegalStateException("Incompatible EBSX projection property: " + key);
                        }
                    }
                    for (String key : new String[] {"length", "precision"}) {
                        int before = original.path(key).asInt(0);
                        int next = column.path(key).asInt(0);
                        if (next > before) {
                            original.put(key, next);
                            Map<String, Object> adaptation = new LinkedHashMap<>();
                            adaptation.put("link", link);
                            adaptation.put("table", target.path("name").asText());
                            adaptation.put("column", original.path("name").asText());
                            adaptation.put("property", key);
                            adaptation.put("before", before);
                            adaptation.put("after", next);
                            adaptations.add(adaptation);
                        }
                    }
                }
                Map<String, ObjectNode> indices = new LinkedHashMap<>();
                ArrayNode existing = (ArrayNode) target.get("getAllPSSysDBIndices");
                if (existing == null) existing = target.putArray("getAllPSSysDBIndices");
                for (JsonNode index : existing) indices.put(index.path("codeName").asText(), (ObjectNode) index);
                ArrayNode projected = (ArrayNode) projection.get("getAllPSSysDBIndices");
                if (projected != null) for (JsonNode index : projected) {
                    String code = index.path("codeName").asText();
                    if (!"NORMAL".equals(index.path("indexType").asText())
                        || !code.matches("[A-Za-z][A-Za-z0-9_]*")) {
                        throw new IllegalStateException("Unreviewed index definition");
                    }
                    ObjectNode previous = indices.get(code);
                    if (previous == null) {
                        ObjectNode copy = index.deepCopy();
                        existing.add(copy);
                        indices.put(code, copy);
                    } else if (!previous.path("getAllPSSysDBIndexColumns").equals(index.path("getAllPSSysDBIndexColumns"))) {
                        throw new IllegalStateException("Conflicting same-name projection index");
                    }
                }
            }
        }
        evidence.put("modelSha256", hashes);
        evidence.put("adaptations", adaptations);
        evidence.put("mergedModelSha256", sha(JSON.writeValueAsBytes(merged)));
        return merged;
    }

    private static Object context(Class<?> type, Map<String, Object> methods) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (proxy, method, args) -> {
            if (methods.containsKey(method.getName())) return methods.get(method.getName());
            if ("toString".equals(method.getName())) return "OwnedEbsxFixtureContext";
            throw new UnsupportedOperationException("Unreviewed adapter context call: " + method.getName());
        });
    }

    private static void expectSqlDenied(Connection connection, String sql, int... expectedCodes) throws Exception {
        try (java.sql.Statement statement = connection.createStatement()) {
            try {
                statement.execute(sql);
                throw new IllegalStateException("Runtime operation unexpectedly allowed");
            } catch (SQLException denied) {
                for (int code : expectedCodes) if (denied.getErrorCode() == code) return;
                throw denied;
            }
        }
    }

    private static void verifyStructure(Connection connection, ObjectNode model, Map<String, Object> evidence) throws Exception {
        DatabaseMetaData metadata = connection.getMetaData();
        Map<String, ObjectNode> expected = byName((ArrayNode) model.get("getAllPSSysDBTables"));
        int columnCount = 0;
        int indexCount = 0;
        for (ObjectNode table : expected.values()) {
            String name = table.path("name").asText().toLowerCase(java.util.Locale.ROOT);
            Map<String, Integer> columns = new TreeMap<>();
            try (ResultSet rows = metadata.getColumns(connection.getCatalog(), null, name, null)) {
                while (rows.next()) columns.put(rows.getString("COLUMN_NAME").toUpperCase(java.util.Locale.ROOT),
                    rows.getInt("COLUMN_SIZE"));
            }
            Map<String, ObjectNode> wantedColumns = byName((ArrayNode) table.get("getAllPSSysDBColumns"));
            if (!columns.keySet().equals(wantedColumns.keySet())) throw new IllegalStateException("Physical column set differs: " + name);
            for (ObjectNode column : wantedColumns.values()) {
                if (column.path("stdDataType").asInt() == 25
                    && columns.get(column.path("name").asText()) < column.path("length").asInt()) {
                    throw new IllegalStateException("String capacity too small: " + name);
                }
            }
            List<String> keys = new ArrayList<>();
            try (ResultSet rows = metadata.getPrimaryKeys(connection.getCatalog(), null, name)) {
                while (rows.next()) keys.add(rows.getString("COLUMN_NAME").toUpperCase(java.util.Locale.ROOT));
            }
            List<String> expectedKeys = new ArrayList<>();
            for (ObjectNode column : wantedColumns.values()) if (column.path("pKey").asBoolean()) {
                expectedKeys.add(column.path("name").asText());
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
            ArrayNode wantedIndices = (ArrayNode) table.get("getAllPSSysDBIndices");
            if (wantedIndices != null) for (JsonNode index : wantedIndices) {
                List<String> names = new ArrayList<>();
                for (JsonNode column : index.path("getAllPSSysDBIndexColumns")) names.add(column.path("name").asText());
                if (!names.equals(indices.get(index.path("codeName").asText().toLowerCase(java.util.Locale.ROOT)))) {
                    throw new IllegalStateException("Index differs: " + name + "." + index.path("codeName").asText());
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
        List<String> wanted = new ArrayList<>(expected.keySet());
        Collections.sort(wanted);
        if (!observed.equals(wanted)) throw new IllegalStateException("Unexpected or missing EBSX tables");
        evidence.put("tables", wanted);
        evidence.put("columnsVerified", columnCount);
        evidence.put("indicesVerified", indexCount);
        evidence.put("primaryKeysVerified", true);
    }

    public static void main(String[] args) throws Throwable {
        Map<String, String> input = JSON.readValue(System.in, new TypeReference<Map<String, String>>() {});
        String run = input.get("runId");
        String mode = input.get("mode");
        if (run == null || !run.matches("[a-f0-9]{12}")
            || !("bootstrap".equals(mode) || "verify".equals(mode))) {
            throw new IllegalArgumentException("Explicit owned EBSX fixture required");
        }
        String schema = "nf_" + run + "_ebsx";
        String user = "nf_" + run + ("bootstrap".equals(mode) ? "_ebsx_ddl" : "_ebsx_app");
        String url = "jdbc:mysql://nf-" + run + "-mysql:3306/" + schema
            + "?useUnicode=true&characterEncoding=UTF-8&useSSL=false";
        if (!url.equals(input.get("url")) || !user.equals(input.get("username"))
            || input.get("password") == null || !input.get("password").matches("[a-f0-9]{36}")) {
            throw new IllegalArgumentException("Foreign schema or principal");
        }
        PrintStream output = System.out;
        System.setOut(System.err);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", mode);
        ObjectNode physicalModel = mergedModel(result);
        PSModelServiceImpl service = new PSModelServiceImpl();
        service.setPSModelFolderPath("/sysmodel/saas-ebsx", true);
        IPSSysDBScheme scheme = service.getPSModelObject(null, IPSSysDBScheme.class, physicalModel, null);
        if ("bootstrap".equals(mode)) {
            new ServiceHub();
            Map<String, Object> systemMethods = new LinkedHashMap<>();
            systemMethods.put("getFileFolder", "/tmp/ebsx-model");
            systemMethods.put("getDeploySystemId", "ebsx");
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
            verifyStructure(connection, physicalModel, result);
            if ("verify".equals(mode)) {
                try (PreparedStatement count = connection.prepareStatement(
                        "SELECT COUNT(*) FROM SYS_ROLE_MEMBER");
                     ResultSet rows = count.executeQuery()) {
                    rows.next();
                    int projectionRows = rows.getInt(1);
                    if (projectionRows <= 0) {
                        throw new IllegalStateException("Owned UAA membership projection is empty");
                    }
                    result.put("permissionProjectionRows", projectionRows);
                }
                expectSqlDenied(connection, "UPDATE SYS_ROLE_MEMBER SET ROLE_ID=ROLE_ID WHERE 1=0", 1288);
                expectSqlDenied(connection, "DELETE FROM SYS_ROLE_MEMBER WHERE 1=0", 1288);
                expectSqlDenied(connection,
                    "INSERT INTO SYS_ROLE_MEMBER (DC,ROLE_ID,MEMBER_TYPE,MEMBER_UID) "
                        + "SELECT DC,ROLE_ID,MEMBER_TYPE,MEMBER_UID FROM SYS_ROLE_MEMBER WHERE 1=0", 1471);
                expectSqlDenied(connection, "SELECT MEMBER_UID FROM nf_" + run + "_uaa.sys_role_member", 1142);
                expectSqlDenied(connection, "SELECT USER_PASSWORD FROM nf_" + run + "_uaa.sys_person", 1142);
                result.put("permissionProjectionDmlDenied", true);
                result.put("uaaDirectReadDenied", true);
                String id = "nf_" + run + "_schema_probe";
                try (PreparedStatement create = connection.prepareStatement(
                        "INSERT INTO jobs_info2 (ID, APP, AUTHOR, STATUS) VALUES (?, ?, ?, ?)")) {
                    create.setString(1, id); create.setString(2, "owned-schema");
                    create.setString(3, "before"); create.setInt(4, 0); create.executeUpdate();
                }
                try {
                    try (PreparedStatement update = connection.prepareStatement("UPDATE jobs_info2 SET AUTHOR=? WHERE ID=?")) {
                        update.setString(1, "after"); update.setString(2, id);
                        if (update.executeUpdate() != 1) throw new IllegalStateException("Owned update failed");
                    }
                    try (PreparedStatement select = connection.prepareStatement("SELECT AUTHOR FROM jobs_info2 WHERE ID=?")) {
                        select.setString(1, id);
                        try (ResultSet rows = select.executeQuery()) {
                            if (!rows.next() || !"after".equals(rows.getString(1))) throw new IllegalStateException("Readback failed");
                        }
                    }
                } finally {
                    try (PreparedStatement remove = connection.prepareStatement("DELETE FROM jobs_info2 WHERE ID=?")) {
                        remove.setString(1, id); remove.executeUpdate();
                    }
                }
                try (java.sql.Statement statement = connection.createStatement()) {
                    try {
                        statement.executeUpdate("CREATE TABLE owned_runtime_ddl_probe (id INT)");
                        throw new IllegalStateException("Runtime principal unexpectedly has DDL privileges");
                    } catch (SQLException denied) {
                        if (denied.getErrorCode() != 1142) throw denied;
                    }
                }
                result.put("crudVerified", true);
                result.put("runtimeDdlDenied", true);
                result.put("probeRemoved", true);
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
