import groovy.json.JsonOutput
import net.ibizsys.central.dataentity.logic.DELogicEndNodeRuntime
import net.ibizsys.central.dataentity.logic.DELogicPrepareParamNodeRuntime
import net.ibizsys.central.dataentity.logic.IDELogicSession
import net.ibizsys.model.PSModelServiceImpl
import net.ibizsys.model.dataentity.logic.IPSDELogic
import cn.ibizlab.plm.wiki.articlepage.dto.ArticlePageDTO

def mode = args[1]
assert mode in ['sealed-native', 'current-source']
def loader = new GroovyClassLoader(this.class.classLoader)
def common = '''
    net.ibizsys.central.ISystemRuntime system = new net.ibizsys.central.SystemRuntime()
    Map parameters
    List trace = []
    net.ibizsys.central.ISystemRuntime getSystemRuntime() { system }
    Object param(String name) {
        def value = parameters[name.toLowerCase()]
        assert value != null
        [getReal: { -> value }]
    }
    net.ibizsys.central.dataentity.logic.IDELogicParamRuntime getDELogicParamRuntime(String name, boolean optional) {
        def key = name.toLowerCase()
        assert parameters.containsKey(key)
        [
            getCodeName: { -> name },
            getParamObject: { session -> parameters[key] },
            getReal: { session -> parameters[key] },
            get: { session, field -> parameters[key].get(field.toLowerCase()) },
            set: { session, field, value -> parameters[key].set(field.toLowerCase(), value) }
        ] as net.ibizsys.central.dataentity.logic.IDELogicParamRuntime
    }
    protected net.ibizsys.central.dataentity.logic.IDELogicNodeRuntime getDELogicNodeRuntime(net.ibizsys.model.dataentity.logic.IPSDELogicNode node) {
        [
            execute: { context, session, actual ->
                trace.add(actual.codeName)
                if (actual.logicNodeType == 'END')
                    new net.ibizsys.central.dataentity.logic.DELogicEndNodeRuntime().execute(context, session, actual)
                else if (actual.logicNodeType == 'PREPAREPARAM')
                    new net.ibizsys.central.dataentity.logic.DELogicPrepareParamNodeRuntime().execute(context, session, actual)
                else if (actual.logicNodeType == 'RAWSFCODE')
                    new GroovyShell(new Binding([sys: system, logic: this])).evaluate(actual.code)
                else throw new AssertionError('Unexpected controlled node')
            }
        ] as net.ibizsys.central.dataentity.logic.IDELogicNodeRuntime
    }
    void dispatch(net.ibizsys.central.dataentity.logic.IDELogicSession session, net.ibizsys.model.dataentity.logic.IPSDELogicNode node) {
        onExecutePSDELogicNode(session, node)
    }
'''
def types = [:]
['CheckShared', 'AccessPassword'].each { name ->
    types[name] = loader.parseClass("class Owned${name}Probe extends cn.ibizlab.plm.wiki.articlepage.logic.${name} {\n${common}\n}")
}
def models = new PSModelServiceImpl()
models.setPSModelFolderPath(args[0])
def rows = []
['check_shared', 'access_password'].each { name ->
    def flow = models.getPSModelObject(null, IPSDELogic.class,
        "PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/${name}.json")
    def raw = flow.PSDELogicNodes.find { it.codeName == 'RAWSFCODE1' }
    [false, true].each { expired ->
        [false, true].each { passwordCase ->
            def input = new ArticlePageDTO()
            input.set('id', 'owned-dispatch-page')
            input.set('access_password', passwordCase ? 'owned-probe' : 'wrong-probe')
            def stored = new ArticlePageDTO()
            stored.set('id', 'owned-dispatch-page')
            stored.set('access_password', name == 'check_shared' && !passwordCase ? null : 'owned-probe')
            stored.set('expiration_date', java.sql.Timestamp.valueOf(
                java.time.LocalDateTime.now().plusDays(expired ? -2 : 2)))
            def result = new ArticlePageDTO()
            def params = name == 'check_shared'
                ? [default: stored, result: result]
                : [default: input, check_page: stored]
            def probe = types[name == 'check_shared' ? 'CheckShared' : 'AccessPassword'].newInstance()
            probe.parameters = params
            def state = [next: null, lastReturn: null, result: null]
            def session = [
                getDELogicRuntime: { -> probe },
                getNext: { -> state.next }, setNext: { value -> state.next = value },
                getLastReturn: { -> state.lastReturn }, setLastReturn: { value -> state.lastReturn = value },
                getResult: { -> state.result }, setResult: { value -> state.result = value },
                debugEnterNode: { runtime, node -> }, debugExitNode: { runtime, node -> },
                debugEnterLink: { runtime, node, link -> }, debugInfo: { value -> }
            ] as IDELogicSession
            probe.dispatch(session, raw)
            def returned = name == 'check_shared' ? result : input
            assert returned.get('effective') == (expired ? 0 : 1)
            if (mode == 'current-source') {
                assert state.result.is(returned)
                def expectedTrace = ['RAWSFCODE1']
                if (name == 'access_password' && !expired)
                    expectedTrace.add(passwordCase ? 'PREPAREPARAM1' : 'PREPAREPARAM2')
                expectedTrace.add('END1')
                assert probe.trace == expectedTrace
                if (name == 'access_password')
                    assert returned.get('check_access_password').toString() == ((!expired && passwordCase) ? '1' : '0')
            } else {
                assert state.result == null
                assert probe.trace.isEmpty()
                if (name == 'access_password') assert returned.get('check_access_password') == 0
            }
            if (name == 'check_shared')
                assert returned.get('check_access_pwd') == (passwordCase ? 1 : 0)
            rows.add([name: name, expired: expired, passwordCase: passwordCase,
                trace: probe.trace, resultNull: state.result == null,
                resultIsOriginalDTO: state.result?.is(returned) ?: false,
                effective: returned.get('effective'),
                checkPassword: name == 'access_password' ? returned.get('check_access_password') : returned.get('check_access_pwd')])
        }
    }
}
println JsonOutput.toJson([
    mode: mode, rows: rows, HTTPExecuted: false, databaseExecuted: false,
    sharedRuntimeModified: false, startNode: 'RAWSFCODE1', businessAcceptance: false,
    classes: [
        checkShared: cn.ibizlab.plm.wiki.articlepage.logic.CheckShared.protectionDomain.codeSource.location.toString(),
        accessPassword: cn.ibizlab.plm.wiki.articlepage.logic.AccessPassword.protectionDomain.codeSource.location.toString(),
        dto: ArticlePageDTO.protectionDomain.codeSource.location.toString(),
        dispatcher: net.ibizsys.central.dataentity.logic.DELogicRuntime.protectionDomain.codeSource.location.toString(),
        prepare: DELogicPrepareParamNodeRuntime.protectionDomain.codeSource.location.toString(),
        end: DELogicEndNodeRuntime.protectionDomain.codeSource.location.toString()
    ]
])
