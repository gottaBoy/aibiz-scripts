import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.PrintStream;
import java.lang.reflect.Proxy;
import java.util.LinkedHashMap;
import java.util.Map;
import net.ibizsys.central.ISystemGatewayContext;
import net.ibizsys.central.app.IApplicationRuntime;
import net.ibizsys.central.cloud.core.ServiceSystemRuntimeBase;
import net.ibizsys.central.cloud.core.spring.util.GatewayUtils;
import net.ibizsys.model.PSModelServiceImpl;
import net.ibizsys.model.app.IPSApplication;
import net.ibizsys.runtime.util.JsonUtils;

/** Probes packaged application construction and canonical routes without Spring, SQL or network. */
public final class OwnedModelingApplicationRoutesProbe {
    private static final class Factory extends ServiceSystemRuntimeBase {
        private final boolean enabled;

        Factory(boolean enabled) {
            this.enabled = enabled;
        }

        @Override
        protected ISystemGatewayContext getSystemGatewayContext() {
            return (ISystemGatewayContext) Proxy.newProxyInstance(
                ISystemGatewayContext.class.getClassLoader(),
                new Class<?>[] {ISystemGatewayContext.class},
                (proxy, method, args) -> {
                    if ("isEnableAppGateway".equals(method.getName())) return enabled;
                    throw new UnsupportedOperationException("Unexpected factory context call");
                });
        }

        IApplicationRuntime create(IPSApplication app) {
            return this.createApplicationRuntime(app);
        }
    }

    public static void main(String[] args) throws Exception {
        PrintStream output = System.out;
        System.setOut(System.err);
        PSModelServiceImpl models = new PSModelServiceImpl();
        models.setPSModelFolderPath("/model", false);
        IPSApplication selected = null;
        for (IPSApplication app : models.getPSSystem().getAllPSApps()) {
            if ("ModelDesign".equals(app.getCodeName())) {
                if (selected != null) throw new IllegalStateException("Duplicate application");
                selected = app;
            }
        }
        if (selected == null) throw new IllegalStateException("Missing ModelDesign application");
        if (new Factory(false).create(selected) != null) {
            throw new IllegalStateException("Disabled factory no longer reproduces the missing runtime");
        }
        IApplicationRuntime runtime = new Factory(true).create(selected);
        if (runtime == null) throw new IllegalStateException("Enabled factory did not create a runtime");
        ObjectNode generated = GatewayUtils.getAppGatewayNode("ibizmodeling", "ibizmodeling", selected);
        JsonNode route = null;
        for (JsonNode candidate : generated.path("routes")) {
            if ("ibizmodeling__modeldesign__psdevslnsys".equals(candidate.path("id").asText())) {
                if (route != null) throw new IllegalStateException("Duplicate root route");
                route = candidate;
            }
        }
        if (route == null) throw new IllegalStateException("No canonical root route");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("contract", "owned-modeling-application-route-probe-v1");
        result.put("application", selected.getCodeName());
        result.put("disabledFactoryReturnedNull", true);
        result.put("enabledFactoryClass", runtime.getClass().getName());
        result.put("canonicalRoute", route);
        result.put("generatorOrigin", GatewayUtils.class.getProtectionDomain().getCodeSource().getLocation().toString());
        result.put("factoryOrigin", ServiceSystemRuntimeBase.class.getProtectionDomain().getCodeSource().getLocation().toString());
        output.println(JsonUtils.MAPPER.writeValueAsString(result));
    }
}
