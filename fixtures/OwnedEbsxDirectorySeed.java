import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

public final class OwnedEbsxDirectorySeed {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String[] TABLES = {
        "IBZPSSYSTEM", "IBZCENTER", "IBZCENTER", "IBZDCSYSTEM", "IBZDCSYSTEM"
    };
    private static final String[][] COLUMNS = {
        {"PSSYSTEMID", "PSSYSTEMNAME"}, {"CENTERID", "CENTERNAME"}, {"CENTERID", "CENTERNAME"},
        {"DCSYSTEMID", "DCSYSTEMNAME", "SYSTEMID", "SRFDCID"},
        {"DCSYSTEMID", "DCSYSTEMNAME", "SYSTEMID", "SRFDCID"}
    };

    public static void main(String[] args) throws Exception {
        JsonNode input = JSON.readTree(Files.readAllBytes(Paths.get("/inputs/input.private.json")));
        String run = input.path("runId").asText();
        if (!run.matches("[a-f0-9]{12}")) throw new IllegalArgumentException("Invalid owned run");
        String schema = "nf_" + run + "_ebsx";
        String expectedUrl = "jdbc:mysql://nf-" + run + "-mysql:3306/" + schema
            + "?useUnicode=true&characterEncoding=UTF-8&useSSL=false";
        if (!expectedUrl.equals(input.path("url").asText())
            || !("nf_" + run + "_ebsx_app").equals(input.path("username").asText())
            || !input.path("password").asText().matches("[a-f0-9]{36}")
            || input.path("rows").size() != 5) throw new IllegalArgumentException("Invalid owned datasource or rows");
        JsonNode rows = input.path("rows");
        for (int i = 0; i < TABLES.length; i++) {
            JsonNode row = rows.get(i);
            if (!TABLES[i].equals(row.path("table").asText())
                || row.path("values").size() != COLUMNS[i].length) throw new IllegalArgumentException("Directory row drift");
            for (String column : COLUMNS[i]) {
                JsonNode value = row.path("values").path(column);
                if (!value.isTextual() || value.asText().isEmpty() || value.asText().length() > 200
                    || value.asText().indexOf('\0') >= 0) throw new IllegalArgumentException("Invalid directory field");
            }
            String center = "nf_" + run + "_center_" + (i == 1 || i == 3 ? "a" : "b");
            if (i == 0 && !"ibizmodeling".equals(row.path("values").path("PSSYSTEMID").asText())) {
                throw new IllegalArgumentException("Foreign system");
            }
            if ((i == 1 || i == 2) && !center.equals(row.path("values").path("CENTERID").asText())) {
                throw new IllegalArgumentException("Foreign center");
            }
            if (i >= 3 && (!(center + "_deploy").equals(row.path("values").path("DCSYSTEMID").asText())
                || !center.equals(row.path("values").path("SRFDCID").asText())
                || !"ibizmodeling".equals(row.path("values").path("SYSTEMID").asText()))) {
                throw new IllegalArgumentException("Foreign deployment");
            }
        }
        try (Connection connection = DriverManager.getConnection(expectedUrl,
                input.path("username").asText(), input.path("password").asText())) {
            connection.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
            connection.setAutoCommit(false);
            try {
                // Lock all three empty owned directory ranges before inserting anything.
                for (int i : new int[] {0, 1, 3}) {
                    try (PreparedStatement query = connection.prepareStatement(
                            "SELECT `" + COLUMNS[i][0] + "` FROM `" + TABLES[i] + "` FOR UPDATE");
                         ResultSet found = query.executeQuery()) {
                        if (found.next()) throw new IllegalStateException("Directory is not empty");
                    }
                }
                int inserted = 0;
                for (int i = 0; i < TABLES.length; i++) {
                    String[] marks = new String[COLUMNS[i].length];
                    Arrays.fill(marks, "?");
                    String statement = "INSERT INTO `" + TABLES[i] + "` (`"
                        + String.join("`,`", COLUMNS[i]) + "`) VALUES (" + String.join(",", marks) + ")";
                    try (PreparedStatement insert = connection.prepareStatement(statement)) {
                        for (int j = 0; j < COLUMNS[i].length; j++) {
                            insert.setString(j + 1, rows.get(i).path("values").path(COLUMNS[i][j]).asText());
                        }
                        if (insert.executeUpdate() != 1) throw new IllegalStateException("Directory insert count differs");
                        inserted++;
                    }
                }
                for (int i : new int[] {0, 1, 3}) {
                    try (PreparedStatement query = connection.prepareStatement("SELECT COUNT(*) FROM `" + TABLES[i] + "`");
                         ResultSet count = query.executeQuery()) {
                        if (!count.next() || count.getInt(1) != (i == 0 ? 1 : 2)) {
                            throw new IllegalStateException("Directory transaction readback differs");
                        }
                    }
                }
                connection.commit();
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("contract", "owned-ebsx-directory-jdbc-v1");
                result.put("runId", run);
                result.put("inserted", inserted);
                result.put("committed", true);
                result.put("principal", connection.getMetaData().getUserName());
                System.out.println(JSON.writeValueAsString(result));
            } catch (Exception failure) {
                connection.rollback();
                throw failure;
            }
        }
    }
}
