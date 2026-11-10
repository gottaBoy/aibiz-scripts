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
        if (!expectedUrl.equals(input.get("url")) || !user.equals(input.get("username"))
            || input.get("password") == null || !input.get("password").matches("[a-f0-9]{36}")) {
            throw new IllegalArgumentException("Foreign workflow database or principal");
        }
        PrintStream output = System.out;
        System.setOut(System.err);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", mode);
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
