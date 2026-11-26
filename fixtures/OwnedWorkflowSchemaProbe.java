import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.PrintStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.util.LinkedHashMap;
import java.util.Map;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.idm.engine.IdmEngine;

/** Fixture-only migration and CRUD probe; never added to an application image. */
public final class OwnedWorkflowSchemaProbe {
    private static String hostSha(java.nio.file.Path path) throws Exception {
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        try (java.io.InputStream stream = java.nio.file.Files.newInputStream(path)) {
            byte[] buffer = new byte[65536];
            for (int count; (count = stream.read(buffer)) >= 0;) digest.update(buffer, 0, count);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) result.append(String.format("%02x", value & 255));
        return result.toString();
    }

    private static String ownedHostUrl(Map<String, String> input, String run, String schema, String user)
            throws Exception {
        if (!"owned-host-v1".equals(input.get("hostTransport"))
            || !user.equals(input.get("username"))
            || !input.getOrDefault("password", "").matches("[a-f0-9]{36}")) {
            throw new IllegalArgumentException("Explicit owned host SQL transport required");
        }
        int port = Integer.parseInt(input.get("hostPort"));
        long pid = Long.parseLong(input.get("hostPid"));
        java.nio.file.Path directory = java.nio.file.Paths.get(input.get("hostDirectory"));
        if (port < 1024 || port > 65535 || port == 3306 || pid <= 1
            || !directory.toString().matches(".*/\\.artifacts/native-nonadmin-fixtures/" + run
                + "/backend-host-[a-z0-9][a-z0-9-]{0,28}")
            || !directory.equals(directory.toRealPath())
            || ProcessHandle.of(pid).flatMap(ProcessHandle::parent).map(ProcessHandle::pid).orElse(-1L).longValue()
                != ProcessHandle.current().parent().map(ProcessHandle::pid).orElse(-2L).longValue()) {
            throw new IllegalArgumentException("Foreign host SQL process or directory");
        }
        java.nio.file.Path proc = java.nio.file.Paths.get("/proc", Long.toString(pid));
        String command = new String(java.nio.file.Files.readAllBytes(proc.resolve("cmdline")),
            java.nio.charset.StandardCharsets.UTF_8);
        java.util.List<String> args = java.util.Arrays.asList(command.split(String.valueOf((char) 0)));
        String stat = new String(java.nio.file.Files.readAllBytes(proc.resolve("stat")),
            java.nio.charset.StandardCharsets.UTF_8);
        if (!args.contains("--no-defaults") || !args.contains("--bind-address=127.0.0.1")
            || !args.contains("--port=" + port)
            || !args.contains("--datadir=" + directory.resolve("mysql-data"))
            || !stat.substring(stat.lastIndexOf(')') + 2).trim().split("\\s+")[19]
                .equals(input.get("hostStartTicks"))
            || !hostSha(proc.resolve("cmdline")).equals(input.get("hostCmdlineSha256"))
            || !hostSha(proc.resolve("exe")).equals(input.get("hostExecutableSha256"))) {
            throw new IllegalArgumentException("Host SQL process witness changed");
        }
        for (String kind : new String[] {"RuntimeJar", "Source"}) {
            java.nio.file.Path path = java.nio.file.Paths.get(input.get("host" + kind + "Path"));
            String expected = input.get("host" + kind + "Sha256");
            if (expected == null || !expected.matches("[a-f0-9]{64}")
                || !path.equals(path.toRealPath()) || !hostSha(path).equals(expected)) {
                throw new IllegalArgumentException("Host SQL source or original runtime JAR changed");
            }
        }
        String url = "jdbc:mysql://127.0.0.1:" + port + "/" + schema
            + "?useUnicode=true&characterEncoding=UTF-8&useSSL=false";
        if (!url.equals(input.get("url"))) throw new IllegalArgumentException("Foreign host SQL URL");
        try (Connection connection = DriverManager.getConnection(url, user, input.get("password"));
             java.sql.Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("SELECT @@port,@@datadir")) {
            if (!rows.next() || rows.getInt(1) != port
                || !java.nio.file.Paths.get(rows.getString(2)).toRealPath()
                    .equals(directory.resolve("mysql-data").toRealPath())) {
                throw new IllegalArgumentException("Host SQL server identity changed");
            }
        }
        return url;
    }

    public static void main(String[] args) throws Exception {
        ObjectMapper json = new ObjectMapper();
        Map<String, String> input = json.readValue(System.in, new TypeReference<Map<String, String>>() {});
        String run = input.get("runId");
        String mode = input.get("mode");
        if (run == null || !run.matches("[a-f0-9]{12}")
            || !("bootstrap".equals(mode) || "verify".equals(mode))) {
            throw new IllegalArgumentException("Explicit owned workflow fixture required");
        }
        String expectedUrl = "jdbc:mysql://nf-" + run + "-mysql:3306/nf_" + run
            + "_workflow?useUnicode=true&characterEncoding=UTF-8&useSSL=false";
        String user = "nf_" + run + ("bootstrap".equals(mode) ? "_wf_ddl" : "_wf_app");
        if (input.containsKey("hostTransport")) {
            expectedUrl = ownedHostUrl(input, run, "nf_" + run + "_workflow", user);
        }
        if (!expectedUrl.equals(input.get("url")) || !user.equals(input.get("username"))
            || input.get("password") == null || !input.get("password").matches("[a-f0-9]{36}")) {
            throw new IllegalArgumentException("Foreign workflow database or principal");
        }
        PrintStream output = System.out;
        System.setOut(System.err);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", mode);
        if (input.containsKey("hostTransport")) {
            result.put("hostTransport", input.get("hostTransport"));
            result.put("hostPid", input.get("hostPid"));
            result.put("hostStartTicks", input.get("hostStartTicks"));
            result.put("hostRuntimeJarSha256", input.get("hostRuntimeJarSha256"));
            result.put("hostSourceSha256", input.get("hostSourceSha256"));
        }
        result.put("libraryVersion", ProcessEngine.VERSION);
        result.put("idmLibraryVersion", IdmEngine.VERSION);
        result.put("engineOrigin", ProcessEngine.class.getProtectionDomain().getCodeSource().getLocation().toString());
        result.put("idmOrigin", IdmEngine.class.getProtectionDomain().getCodeSource().getLocation().toString());
        ProcessEngine engine = null;
        try {
            ProcessEngineConfiguration configuration = ProcessEngineConfiguration
                .createStandaloneProcessEngineConfiguration()
                .setJdbcDriver("com.mysql.jdbc.Driver")
                .setJdbcUrl(expectedUrl)
                .setJdbcUsername(user)
                .setJdbcPassword(input.get("password"))
                .setDatabaseSchemaUpdate("bootstrap".equals(mode) ? "true" : "false")
                .setAsyncExecutorActivate(false);
            engine = configuration.buildProcessEngine();
            result.put("engineBuilt", true);
            if ("verify".equals(mode)) {
                String definition = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                    + "<definitions xmlns=\"http://www.omg.org/spec/BPMN/20100524/MODEL\""
                    + " targetNamespace=\"owned-workflow\">"
                    + "<process id=\"ownedWorkflow\" isExecutable=\"true\">"
                    + "<startEvent id=\"start\"/><sequenceFlow id=\"flow\" sourceRef=\"start\" targetRef=\"end\"/>"
                    + "<endEvent id=\"end\"/></process></definitions>";
                Deployment deployment = engine.getRepositoryService().createDeployment()
                    .name("owned-" + run).addString("owned.bpmn20.xml", definition).deploy();
                try {
                    ProcessInstance instance = engine.getRuntimeService()
                        .startProcessInstanceByKey("ownedWorkflow", "owned-" + run);
                    long completed = engine.getHistoryService().createHistoricProcessInstanceQuery()
                        .processInstanceId(instance.getId()).finished().count();
                    if (completed != 1) throw new IllegalStateException("Owned workflow did not complete");
                    result.put("workflowCompleted", true);
                } finally {
                    engine.getRepositoryService().deleteDeployment(deployment.getId(), true);
                }
                if (engine.getRepositoryService().createDeploymentQuery().deploymentName("owned-" + run).count() != 0) {
                    throw new IllegalStateException("Owned workflow deployment was not removed");
                }
                result.put("probeDeploymentRemoved", true);
            }
            try (Connection connection = DriverManager.getConnection(expectedUrl, user, input.get("password"));
                 java.sql.Statement statement = connection.createStatement();
                 ResultSet rows = statement.executeQuery("SELECT DATABASE(), CURRENT_USER()")) {
                if (!rows.next()) throw new IllegalStateException("Missing JDBC identity");
                result.put("schema", rows.getString(1));
                result.put("sqlPrincipal", rows.getString(2));
            }
        } finally {
            if (engine != null) engine.close();
        }
        output.println(json.writeValueAsString(result));
    }
}
