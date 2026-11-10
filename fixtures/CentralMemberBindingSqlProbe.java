import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.ibizsys.model.PSModelServiceImpl;
import net.ibizsys.model.dataentity.IPSDataEntity;
import net.ibizsys.model.dataentity.defield.IPSDEField;
import net.ibizsys.model.dataentity.ds.IPSDEDataQuery;
import net.ibizsys.model.dataentity.ds.IPSDEDataQueryCode;
import net.ibizsys.model.dataentity.ds.IPSDEDataQueryCodeCond;
import net.ibizsys.model.dataentity.ds.IPSDEDQFieldCondition;
import net.ibizsys.model.dataentity.ds.IPSDEDQGroupCondition;

public class CentralMemberBindingSqlProbe {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern PARAM = Pattern.compile(
        "#\\{ctx\\.(sessioncontext\\.srfpersonid|datacontext\\.psdevcenterid)\\}");
    private static final List<String> BRANCHES = Arrays.asList("centerAdminSQL", "schemeAdminSQL", "memberSQL");
    private static final List<String> ALL_A = Arrays.asList("a_empty", "a_expired", "a_other", "a_owned");
    private static final List<String> MEMBERED_A = Arrays.asList("a_expired", "a_other", "a_owned");
    private static final List<String> ALL_B = Arrays.asList("b_empty", "b_owned");
    private final PSModelServiceImpl models = new PSModelServiceImpl();
    private final Map<String, IPSDataEntity> entities = new LinkedHashMap<>();
    private final Map<String, Map<String, IPSDEDataQueryCode>> queryModels = new LinkedHashMap<>();
    private final List<Map<String, Object>> checks = new ArrayList<>();
    private Connection connection;

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("One immutable probe input is required");
        JsonNode input = JSON.readTree(Files.readAllBytes(Paths.get(args[0])));
        new CentralMemberBindingSqlProbe().run(input);
    }

    private void run(JsonNode input) throws Exception {
        require("central-member-binding-native-model-sql-input-v1".equals(input.path("contract").asText()),
            "Unexpected input contract");
        for (JsonNode item : input.path("entities")) {
            IPSDataEntity entity = nativeModel(IPSDataEntity.class, item.path("model"));
            require(entities.put(entity.getTableName(), entity) == null, "Duplicate native entity table");
        }
        require(entities.size() == 6, "Require the six actual referenced native models");
        require("PSDEVUSEROBJID".equals(entities.get("T_SRFPSDEVUSEROBJ").getKeyPSDEField().getName()),
            "Native user-object identity must not be replaced by LOGINNAME or a membership row key");
        verifyModels(input);
        try (Connection db = DriverManager.getConnection("jdbc:h2:mem:central_member_" + UUID.randomUUID() + ";MODE=MySQL")) {
            connection = db;
            seed();
            String before = snapshot();
            verifyIdentityMapping();
            List<Actor> actors = Arrays.asList(
                new Actor("member-a", "person_member_a", "center_a", false, false),
                new Actor("other-member-a", "person_other_a", "center_a", false, false),
                new Actor("nonmember-a", "person_outsider_a", "center_a", false, false),
                new Actor("member-b", "person_member_b", "center_b", false, false),
                new Actor("center-admin-a", "person_center_admin_a", "center_a", true, false),
                new Actor("scheme-owner-a", "person_scheme_owner_a", "center_a", false, true),
                new Actor("scheme-owner-b", "person_scheme_owner_b", "center_b", false, true),
                new Actor("foreign-person-at-a", "person_member_b", "center_a", false, false),
                new Actor("a-person-at-b", "person_member_a", "center_b", false, false),
                new Actor("login-not-object-id", "login_member_a", "center_a", false, false),
                new Actor("grant-row-not-object-id", "grant_a_owned", "center_a", false, false),
                new Actor("anonymous", null, null, false, false),
                new Actor("missing-person", null, "center_a", false, false),
                new Actor("empty-person", "", "center_a", false, false)
            );
            for (Actor actor : actors) {
                for (String version : Arrays.asList("original", "candidate")) {
                    for (String branch : BRANCHES) {
                        List<String> actual = execute(queryModels.get(version).get(branch), actor);
                        expect(version + ":" + branch + ":" + actor.name, actual, expected(version, branch, actor));
                    }
                    List<String> actual = union(version, actor);
                    expect(version + ":published-union:" + actor.name, actual, expectedUnion(version, actor));
                }
                for (String branch : Arrays.asList("centerAdminSQL", "schemeAdminSQL")) {
                    expect("admin-original-semantics:" + branch + ":" + actor.name,
                        execute(queryModels.get("candidate").get(branch), actor),
                        execute(queryModels.get("original").get(branch), actor));
                }
            }
            Actor outsider = actors.get(2);
            require(!union("original", outsider).isEmpty() && union("candidate", outsider).isEmpty(),
                "The original any-member disclosure must be reproduced, not hidden by an empty fixture");
            check("original-any-member-defect-reproduced", true);
            Actor member = actors.get(0);
            require(execute(queryModels.get("candidate").get("memberSQL"), member).contains("a_expired"),
                "Document that this identity-only candidate does not add ACCMODE or EXPIREDTIME enforcement");
            check("identity-only-candidate-does-not-claim-expiry-or-access-mode", true);
            String after = snapshot();
            require(before.equals(after), "Every column of all six native fixture tables and source accounts must remain equal");
            Map<String, Object> report = new LinkedHashMap<>();
            report.put("contract", "central-member-binding-native-model-sql-result-v1");
            report.put("status", "passed-offline-native-model-sql-only");
            report.put("engine", "H2 1.4.200 in-memory MODE=MySQL");
            report.put("modelLoader", PSModelServiceImpl.class.getName());
            report.put("actors", actors.size());
            report.put("nativeQueryBranches", BRANCHES.size());
            report.put("checks", checks);
            report.put("baselineRestored", true);
            report.put("fullColumnBaselineSha256", before);
            report.put("nativeAcceptance", false);
            report.put("permissionAcceptance", false);
            report.put("expiryOrAccessModeAcceptance", false);
            System.out.println(JSON.writeValueAsString(report));
        }
    }

    private <T> T nativeModel(Class<T> type, JsonNode node) {
        require(node instanceof ObjectNode, "Actual native model object required");
        return models.createAndInitPSModelObject(null, type, (ObjectNode) node);
    }

    private void verifyModels(JsonNode input) throws Exception {
        for (String version : Arrays.asList("original", "candidate")) {
            Map<String, IPSDEDataQueryCode> branches = new LinkedHashMap<>();
            for (String branch : BRANCHES) {
                IPSDEDataQueryCode query = nativeModel(IPSDEDataQueryCode.class, input.path(version).path(branch));
                require("MYSQL5".equals(query.getDBType()), "Only the actual MYSQL5 code may execute");
                require(query.getQueryCode().startsWith("SELECT\n"), "Only the actual native SELECT is supported");
                branches.put(branch, query);
            }
            queryModels.put(version, branches);
        }
        IPSDataEntity original = nativeModel(IPSDataEntity.class, input.path("original").path("backendEntity"));
        IPSDataEntity candidate = nativeModel(IPSDataEntity.class, input.path("candidate").path("backendEntity"));
        IPSDEDataQuery oldMember = query(original, "CurDCSLNUser");
        IPSDEDataQuery newMember = query(candidate, "CurDCSLNUser");
        require(oldMember.getPSDEDQMain().getChildPSDEDQJoins().get(0).getPSDEDQGroupCondition() == null,
            "Original member join must really lack the person condition");
        IPSDEDQGroupCondition group = newMember.getPSDEDQMain().getChildPSDEDQJoins().get(0).getPSDEDQGroupCondition();
        require(group != null && "AND".equals(group.getCondOp()) && group.getPSDEDQConditions().size() == 1,
            "Candidate typed native model requires exactly one AND-bound member condition");
        IPSDEDQFieldCondition field = (IPSDEDQFieldCondition) group.getPSDEDQConditions().get(0);
        require("EQ".equals(field.getCondOp()) && "SRFPERSONID".equals(field.getCondValue())
            && "SESSIONCONTEXT".equals(field.getPSVARTypeId()) && !field.isIgnoreEmpty(),
            "Member equality must use non-optional trusted native session context");
        require("PSDEVUSEROBJID".equals(field.getObjectNode().path("fieldName").asText()),
            "Condition must bind the actual membership user-object identity");
        check("native-typed-structured-member-condition", true);
        for (String branch : Arrays.asList("centerAdminSQL", "schemeAdminSQL")) {
            require(input.path("candidate").path(branch).equals(input.path("original").path(branch)),
                "Both complete admin SQL models must remain unchanged");
            check("admin-full-model-preserved:" + branch, true);
        }
        for (String name : Arrays.asList("CurDCAdmin", "CurDCSLNAdmin")) {
            require(query(original, name).getObjectNode().equals(query(candidate, name).getObjectNode()),
                "Both native structured admin branches must remain unchanged");
            check("admin-structured-model-preserved:" + name, true);
        }
        List<String> dataset = new ArrayList<>();
        candidate.getPSDEDataSet("CurDCSLNUser", false).getPSDEDataQueries()
            .forEach(value -> dataset.add(value.getCodeName()));
        require(dataset.equals(Arrays.asList("CurDCAdmin", "CurDCSLNAdmin", "CurDCSLNUser")),
            "Published dataset must retain its original three-branch union");
        check("native-published-union-retained", true);
    }

    private IPSDEDataQuery query(IPSDataEntity entity, String name) {
        return entity.getAllPSDEDataQueries().stream().filter(query -> name.equals(query.getCodeName()))
            .findFirst().orElseThrow(() -> new IllegalStateException("Missing native query " + name));
    }

    private void seed() throws Exception {
        for (Map.Entry<String, IPSDataEntity> entry : entities.entrySet()) {
            List<String> columns = new ArrayList<>();
            for (IPSDEField field : entry.getValue().getAllPSDEFields()) {
                require(field.getName().matches("[A-Z][A-Z0-9_]*"), "Unsafe native fixture field");
                columns.add("`" + field.getName() + "` VARCHAR(2000)");
            }
            connection.createStatement().execute("CREATE TABLE `" + entry.getKey() + "` (" + String.join(",", columns) + ")");
        }
        connection.createStatement().execute("CREATE TABLE SOURCE_PERSON (ID VARCHAR(100),UID VARCHAR(100),DC VARCHAR(100))");
        for (String center : Arrays.asList("center_a", "center_b")) {
            insert("T_SRFPSDEVCENTER", row("PSDEVCENTERID", center, "PSDEVCENTERNAME", center));
        }
        person("person_member_a", "login_member_a", "center_a", false);
        person("person_other_a", "login_other_a", "center_a", false);
        person("person_outsider_a", "login_outsider_a", "center_a", false);
        person("person_member_b", "login_member_b", "center_b", false);
        person("person_center_admin_a", "login_center_admin_a", "center_a", true);
        person("person_scheme_owner_a", "login_scheme_owner_a", "center_a", false);
        person("person_scheme_owner_b", "login_scheme_owner_b", "center_b", false);
        for (String id : ALL_A) scheme(id, "center_a", "person_scheme_owner_a");
        for (String id : ALL_B) scheme(id, "center_b", "person_scheme_owner_b");
        grant("grant_a_owned", "a_owned", "person_member_a", "3", null);
        grant("grant_a_other", "a_other", "person_other_a", "1", null);
        grant("grant_a_expired", "a_expired", "person_member_a", "0", "2000-01-01 00:00:00");
        grant("grant_b_owned", "b_owned", "person_member_b", "3", null);
    }

    private void person(String id, String login, String center, boolean admin) throws Exception {
        insert("SOURCE_PERSON", row("ID", id, "UID", login, "DC", center));
        insert("T_SRFPSDEVUSER", row("PSDEVUSERID", id, "LOGINNAME", login,
            "PSDEVUSERNAME", login, "ADMINMODE", admin ? "1" : "0", "ENABLE", "1"));
        insert("T_SRFPSDEVUSEROBJ", row("PSDEVUSEROBJID", id, "PSDEVCENTERID", center,
            "PSDEVUSEROBJNAME", login, "PSDEVUSEROBJTYPE", "USER", "ENABLE", "1", "VALIDFLAG", "1"));
    }

    private void scheme(String id, String center, String owner) throws Exception {
        insert("T_SRFPSDEVSLN", row("PSDEVSLNID", id, "PSDEVSLNNAME", id,
            "PSDEVCENTERID", center, "ADMINPSDEVUSERID", owner));
    }

    private void grant(String id, String scheme, String person, String mode, String expiry) throws Exception {
        insert("T_SRFPSDEVSLNUSER", row("PSDEVSLNUSERID", id, "PSDEVSLNID", scheme,
            "PSDEVUSEROBJID", person, "ACCMODE", mode, "EXPIREDTIME", expiry, "ALLSYSFLAG", "1"));
    }

    private Map<String, String> row(String... parts) {
        Map<String, String> value = new LinkedHashMap<>();
        for (int index = 0; index < parts.length; index += 2) value.put(parts[index], parts[index + 1]);
        return value;
    }

    private void insert(String table, Map<String, String> values) throws Exception {
        String sql = "INSERT INTO `" + table + "` (`" + String.join("`,`", values.keySet()) + "`) VALUES ("
            + String.join(",", java.util.Collections.nCopies(values.size(), "?")) + ")";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            int index = 1;
            for (String value : values.values()) statement.setString(index++, value);
            require(statement.executeUpdate() == 1, "Synthetic fixture insert failed");
        }
    }

    private void verifyIdentityMapping() throws Exception {
        String sql = "SELECT p.ID,d.PSDEVUSERID,o.PSDEVUSEROBJID FROM SOURCE_PERSON p"
            + " JOIN T_SRFPSDEVUSER d ON d.LOGINNAME=p.UID AND d.PSDEVUSERID=p.ID"
            + " JOIN T_SRFPSDEVUSEROBJ o ON o.PSDEVUSEROBJID=d.PSDEVUSERID AND o.PSDEVCENTERID=p.DC"
            + " WHERE p.ID=? AND p.UID=? AND p.DC=?";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, "person_member_a");
            statement.setString(2, "login_member_a");
            statement.setString(3, "center_a");
            try (ResultSet rows = statement.executeQuery()) {
                require(rows.next(), "Trusted person/developer/user-object mapping must exist");
                require("person_member_a".equals(rows.getString(1)) && rows.getString(1).equals(rows.getString(2))
                    && rows.getString(2).equals(rows.getString(3)), "Actual object identity mismatch");
                require(!rows.next(), "Ambiguous developer identity must never be accepted");
            }
        }
        check("source-person-developer-user-object-fixture-mapping", true);
        check("login-and-membership-row-ids-distinct-from-person", true);
    }

    private List<String> execute(IPSDEDataQueryCode model, Actor actor) throws Exception {
        Query query = prepare(model, actor);
        return select(query.sql, query.values);
    }

    private List<String> union(String version, Actor actor) throws Exception {
        List<String> sql = new ArrayList<>();
        List<String> values = new ArrayList<>();
        for (String branch : BRANCHES) {
            Query query = prepare(queryModels.get(version).get(branch), actor);
            sql.add(query.sql);
            values.addAll(query.values);
        }
        return select(String.join("\nUNION\n", sql), values);
    }

    private Query prepare(IPSDEDataQueryCode model, Actor actor) {
        List<String> conditions = new ArrayList<>();
        for (IPSDEDataQueryCodeCond condition : model.getPSDEDataQueryCodeConds()) {
            require("CUSTOM".equals(condition.getCondType()), "Only actual audited CUSTOM conditions supported");
            conditions.add("(" + condition.getCustomCond() + ")");
        }
        String sql = model.getQueryCode() + " WHERE " + String.join(" AND ", conditions);
        require(!sql.contains(";"), "Only a single SELECT query is allowed");
        Matcher matcher = PARAM.matcher(sql);
        List<String> values = new ArrayList<>();
        StringBuffer bound = new StringBuffer();
        while (matcher.find()) {
            values.add(matcher.group(1).startsWith("sessioncontext") ? actor.person : actor.center);
            matcher.appendReplacement(bound, "?");
        }
        matcher.appendTail(bound);
        require(bound.indexOf("#{") < 0, "Unreviewed native SQL parameter");
        return new Query(bound.toString(), values);
    }

    private List<String> select(String sql, List<String> values) throws Exception {
        List<String> ids = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < values.size(); index++) statement.setString(index + 1, values.get(index));
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) ids.add(rows.getString("PSDEVSLNID"));
            }
        }
        java.util.Collections.sort(ids);
        return ids;
    }

    private List<String> expected(String version, String branch, Actor actor) {
        if ("centerAdminSQL".equals(branch)) return actor.centerAdmin && "center_a".equals(actor.center) ? ALL_A : List.of();
        if ("schemeAdminSQL".equals(branch)) return actor.schemeOwner
            ? ("center_a".equals(actor.center) ? ALL_A : ALL_B) : List.of();
        if (actor.center == null) return List.of();
        if ("original".equals(version)) return "center_a".equals(actor.center) ? MEMBERED_A : List.of("b_owned");
        if ("person_member_a".equals(actor.person) && "center_a".equals(actor.center)) return List.of("a_expired", "a_owned");
        if ("person_other_a".equals(actor.person) && "center_a".equals(actor.center)) return List.of("a_other");
        if ("person_member_b".equals(actor.person) && "center_b".equals(actor.center)) return List.of("b_owned");
        return List.of();
    }

    private List<String> expectedUnion(String version, Actor actor) {
        java.util.SortedSet<String> ids = new java.util.TreeSet<>();
        for (String branch : BRANCHES) ids.addAll(expected(version, branch, actor));
        return new ArrayList<>(ids);
    }

    private String snapshot() throws Exception {
        Map<String, Object> snapshot = new TreeMap<>();
        List<String> tables = new ArrayList<>(entities.keySet());
        tables.add("SOURCE_PERSON");
        for (String table : tables) {
            List<Map<String, String>> rows = new ArrayList<>();
            try (Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("SELECT * FROM `" + table + "`")) {
                ResultSetMetaData metadata = result.getMetaData();
                while (result.next()) {
                    Map<String, String> row = new TreeMap<>();
                    for (int index = 1; index <= metadata.getColumnCount(); index++) {
                        row.put(metadata.getColumnLabel(index), result.getString(index));
                    }
                    rows.add(row);
                }
            }
            rows.sort((left, right) -> left.toString().compareTo(right.toString()));
            snapshot.put(table, rows);
        }
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(JSON.writeValueAsBytes(snapshot));
        StringBuilder text = new StringBuilder();
        for (byte value : bytes) text.append(String.format("%02x", value & 0xff));
        return text.toString();
    }

    private void expect(String name, List<String> actual, List<String> expected) {
        require(actual.equals(expected), name + ": expected " + expected + ", actual " + actual);
        Map<String, Object> check = new LinkedHashMap<>();
        check.put("name", name);
        check.put("passed", true);
        check.put("rows", actual);
        checks.add(check);
    }

    private void check(String name, boolean passed) {
        Map<String, Object> check = new LinkedHashMap<>();
        check.put("name", name);
        check.put("passed", passed);
        checks.add(check);
    }

    private static void require(boolean value, String message) {
        if (!value) throw new IllegalStateException(message);
    }

    private record Actor(String name, String person, String center, boolean centerAdmin, boolean schemeOwner) {}
    private record Query(String sql, List<String> values) {}
}
