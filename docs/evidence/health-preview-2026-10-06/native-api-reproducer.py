from pathlib import Path
import argparse, subprocess, sys

parser = argparse.ArgumentParser(description='Bounded native API checks; Expo bridge scaffolding, no app builds.')
parser.add_argument('--repo', type=Path, default=Path('/Users/adam/Documents/mizyun'))
parser.add_argument('--mode', choices=['swift', 'kotlin', 'mutation', 'all'], default='all')
args = parser.parse_args()
module = args.repo / 'apps/mobile/modules/mizyun-health-connections'
out = Path('/private/tmp/mizyun-health-native-check')
out.mkdir(exist_ok=True)

def run(command):
    result = subprocess.run(command, text=True, capture_output=True)
    if result.stdout: print(result.stdout.strip())
    if result.stderr: print(result.stderr.strip())
    return result

def swift():
    # Keep the complete source, including definition() and all escaping closures.
    # Stub only Expo's protocol composition/result builder/async factory boundary,
    # following installed SDK57 signatures; HealthKit/UIKit remain real SDK modules.
    bridge = out/'swift-bridge'
    bridge.mkdir(exist_ok=True)
    scaffold = bridge/'ExpoModulesCore.swift'
    scaffold.write_text('''import Dispatch
public protocol AnyArgument {}
extension String: AnyArgument {}
extension Optional: AnyArgument where Wrapped: AnyArgument {}
public struct Promise: AnyArgument { public func resolve(_ value: Any?) {} }
public protocol AnyDefinition {}
public struct ModuleDefinition {}
@resultBuilder public struct ModuleDefinitionBuilder {
  public static func buildBlock(_ definitions: AnyDefinition...) -> ModuleDefinition { ModuleDefinition() }
}
public protocol AnyModule: AnyObject {
  @ModuleDefinitionBuilder func definition() -> ModuleDefinition
}
open class BaseModule { public init() {} }
public typealias Module = AnyModule & BaseModule
public enum FunctionQueue { case main }
public struct AsyncDefinition: AnyDefinition {
  public func runOnQueue(_ queue: FunctionQueue) -> AsyncDefinition { self }
}
public struct EventDefinition: AnyDefinition {}
public func Name(_ name: String) -> EventDefinition { EventDefinition() }
public func AsyncFunction<R>(_ name: String, _ body: @escaping () throws -> R) -> AsyncDefinition { AsyncDefinition() }
public func AsyncFunction<R, A0: AnyArgument, each A: AnyArgument>(_ name: String, _ body: @escaping (A0, repeat each A) throws -> R) -> AsyncDefinition { AsyncDefinition() }
public func OnAppEntersBackground(_ body: @escaping () -> Void) -> EventDefinition { EventDefinition() }
public func OnDestroy(_ body: @escaping () -> Void) -> EventDefinition { EventDefinition() }
''')
    sdk = subprocess.check_output(['xcrun', '--sdk', 'iphoneos', '--show-sdk-path'], text=True).strip()
    flags = ['-sdk', sdk, '-target', 'arm64-apple-ios16.4', '-module-cache-path', str(out/'swift-cache')]
    result = run(['xcrun', 'swiftc', '-emit-module', '-module-name', 'ExpoModulesCore', *flags, '-emit-module-path', str(bridge/'ExpoModulesCore.swiftmodule'), str(scaffold)])
    assert result.returncode == 0, 'Expo boundary scaffold failed'
    result = run(['xcrun', 'swiftc', '-typecheck', *flags, '-I', str(bridge), str(module/'ios/MizyunHealthConnectionsModule.swift')])
    assert result.returncode == 0, 'Complete Swift native source typecheck failed'
    print('Complete Swift definition/escaping closures and real HealthKit/UIKit APIs, Expo boundary scaffolded: PASS')

base = Path('/Users/adam/.gradle/caches/modules-2/files-2.1')
java = '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java'
def pick(path):
    return next((base/path).glob('*/*.jar'))

def kotlin(mutation=False):
    import zipfile
    compiler = [pick('org.jetbrains.kotlin/kotlin-compiler-embeddable/2.1.20'), pick('org.jetbrains.kotlin/kotlin-stdlib/2.1.20'), pick('org.jetbrains.kotlin/kotlin-script-runtime/2.1.20'), pick('org.jetbrains.kotlin/kotlin-reflect/1.6.10'), pick('org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.10.2'), pick('org.jetbrains/annotations/23.0.0')] + list(base.glob('org.jetbrains.intellij.deps/trove4j/*/*/*.jar'))
    cp = [Path('/Users/adam/Library/Android/sdk/platforms/android-36/android.jar'), compiler[1], compiler[4], compiler[5], pick('androidx.lifecycle/lifecycle-common-jvm/2.10.0'), Path('/Applications/Android Studio.app/Contents/lib/junit4.jar')]
    for name, dependency in [('health', 'androidx.health.connect/connect-client/1.1.0'), ('activity', 'androidx.activity/activity/1.11.0')]:
        path = out/(name+'.jar')
        path.write_bytes(zipfile.ZipFile(next((base/dependency).glob('*/*.aar'))).read('classes.jar'))
        cp.append(path)
    (out/'ActivityBridge.kt').write_text('''package expo.modules.kotlin.activityresult
import android.content.Context
import android.content.Intent
import java.io.Serializable
interface AppContextActivityResultContract<I:Serializable,O> { fun createIntent(context:Context,input:I):Intent; fun parseResult(input:I,resultCode:Int,intent:Intent?):O }
abstract class AppContextActivityResultLauncher<I:Serializable,O> { abstract fun launch(input:I,callback:(O)->Unit) }
''')
    (out/'CoroutineBridge.kt').write_text('''package expo.modules.kotlin.functions
class CoroutineBody
infix fun <R> CoroutineBody.Coroutine(body:suspend ()->R) {}
infix fun <A,R> CoroutineBody.Coroutine(body:suspend (A)->R) {}
infix fun <A,B,C,D,R> CoroutineBody.Coroutine(body:suspend (A,B,C,D)->R) {}
''')
    (out/'ModuleBridge.kt').write_text('''package expo.modules.kotlin.modules
import android.app.Activity
import android.content.Context
import expo.modules.kotlin.functions.CoroutineBody
import expo.modules.kotlin.activityresult.*
import java.io.Serializable
class AppContext { val reactContext:Context?=null;val currentActivity:Activity?=null }
open class Module { val appContext=AppContext();open fun definition()=ModuleDefinition {} }
class ModuleDefinition(body:ModuleDefinition.()->Unit) { init {body()};fun Name(name:String) {};fun AsyncFunction(name:String)=CoroutineBody();fun RegisterActivityContracts(body:ModuleDefinition.()->Unit) {body()};fun <I:Serializable,O> registerForActivityResult(contract:AppContextActivityResultContract<I,O>):AppContextActivityResultLauncher<I,O> = error("scaffold");fun OnActivityEntersForeground(body:()->Unit) {};fun OnActivityEntersBackground(body:()->Unit) {};fun OnActivityDestroys(body:()->Unit) {};fun OnDestroy(body:()->Unit) {} }
''')
    native = module/'android/src/main/java/com/mizyun/healthconnections/HealthConnectionsModule.kt'
    if mutation:
        source = native.read_text()
        old = '    val requestGeneration = generation.get()\n    return readMutex.withLock {'
        assert old in source, 'Mutation boundary missing'
        source = source.replace(old, '    return readMutex.withLock {\n      val requestGeneration = generation.get()', 1)
        native = out/'PreFixHealthConnectionsModule.kt'
        native.write_text(source)
    classes = out/('mutation-classes' if mutation else 'classes')
    command = [java, '-cp', ':'.join(map(str, compiler)), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', ':'.join(map(str, cp)), '-d', str(classes)]
    command += [str(out/x) for x in ['ActivityBridge.kt', 'CoroutineBridge.kt', 'ModuleBridge.kt']] + [str(native), str(module/'android/src/test/java/com/mizyun/healthconnections/HealthConnectionsModuleTest.kt')]
    result = run(command)
    assert result.returncode == 0, 'Kotlin native source/test compile failed'
    runner = out/'QueuedReadCheck.java'
    runner.write_text('class QueuedReadCheck { public static void main(String[] args) throws Exception { Class<?> type=Class.forName("com.mizyun.healthconnections.HealthConnectionsModuleTest"); type.getMethod("queuedReadCannotStartNativeAccessAfterClear").invoke(type.getConstructor().newInstance()); System.out.println("Queued native read / clear regression: PASS"); } }')
    result = run([java, '--class-path', ':'.join(map(str, cp+[classes])), str(runner)])
    if mutation:
        assert result.returncode != 0 and 'expected:<[error]> but was:<[unavailable]>' in result.stderr, 'Mutation did not trigger expected regression'
        print('Pre-fix queued-generation mutation rejected by regression: PASS')
    else:
        assert result.returncode == 0, 'Native queued-read regression failed'
        print('Kotlin real HC1.1/Android36/coroutines APIs and queued-read test, Expo bridge scaffolded: PASS')

if args.mode in ['swift', 'all']: swift()
if args.mode in ['kotlin', 'all']: kotlin()
if args.mode in ['mutation', 'all']: kotlin(mutation=True)
print('Artifacts:', out)
