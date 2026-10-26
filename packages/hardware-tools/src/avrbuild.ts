// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * Compiles an Arduino sketch for the Uno into an Intel HEX image.
 *
 * Two backends: `arduino-cli` when it is installed (the production path, it
 * knows every board and library), else a plain avr-gcc build against a
 * checkout of ArduinoCore-avr (the dev and sandbox fallback, which only
 * needs the Debian `gcc-avr avr-libc` packages and a git clone). Both give
 * the same hex for the same sketch, and both return the compiler's own
 * messages so the agent can read the error it has to fix.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface BuildResult {
    ok: boolean;
    /** The Intel HEX image when the build succeeded. */
    hex?: string;
    /** Compiler output, the errors first. */
    output: string;
    /** Flash and RAM the firmware takes, when known. */
    size?: { flashBytes: number; ramBytes: number };
    backend: 'arduino-cli' | 'avr-gcc';
}

export interface BuildOptions {
    /** Where ArduinoCore-avr is checked out (fallback backend). Default: ROBOLANCE_ARDUINO_CORE. */
    coreDir?: string;
    /** Folders holding Arduino libraries (each with src/). Default: ROBOLANCE_ARDUINO_LIBS, colon separated. */
    libraryDirs?: string[];
    /** Force one backend. */
    backend?: 'arduino-cli' | 'avr-gcc';
    /** Build directory; a hash of the sketch under the OS temp dir by default. */
    buildDir?: string;
}

const MCU = 'atmega328p';
const COMMON_DEFINES = ['-DF_CPU=16000000L', '-DARDUINO=10819', '-DARDUINO_AVR_UNO', '-DARDUINO_ARCH_AVR'];

/** Compiles `sketch` (the contents of a .ino) and returns the hex or the errors. */
export async function buildSketch(sketch: string, options: BuildOptions = {}): Promise<BuildResult> {
    const backend = options.backend ?? (await hasArduinoCli() ? 'arduino-cli' : 'avr-gcc');
    const dir = options.buildDir ?? join(tmpdir(), 'robolance-build', createHash('sha1').update(sketch).digest('hex').slice(0, 16));
    await mkdir(dir, { recursive: true });
    return backend === 'arduino-cli' ? buildWithCli(sketch, dir, options) : buildWithGcc(sketch, dir, options);
}

async function hasArduinoCli(): Promise<boolean> {
    try {
        await run('arduino-cli', ['version']);
        return true;
    } catch {
        return false;
    }
}

async function buildWithCli(sketch: string, dir: string, options: BuildOptions): Promise<BuildResult> {
    const sketchDir = join(dir, 'sketch');
    await mkdir(sketchDir, { recursive: true });
    await writeFile(join(sketchDir, 'sketch.ino'), sketch);
    const args = ['compile', '--fqbn', 'arduino:avr:uno', '--output-dir', join(dir, 'out'), '--warnings', 'default', sketchDir];
    for (const libDir of options.libraryDirs ?? libraryDirsFromEnv()) {
        args.push('--libraries', libDir);
    }
    try {
        const { stdout, stderr } = await run('arduino-cli', args, { maxBuffer: 16 << 20 });
        const hex = await readFile(join(dir, 'out', 'sketch.ino.hex'), 'utf8');
        return { ok: true, hex, output: tidy(stderr + '\n' + stdout), size: parseCliSize(stdout), backend: 'arduino-cli' };
    } catch (err) {
        return { ok: false, output: tidy(errorOutput(err)), backend: 'arduino-cli' };
    }
}

async function buildWithGcc(sketch: string, dir: string, options: BuildOptions): Promise<BuildResult> {
    const coreDir = options.coreDir ?? process.env.ROBOLANCE_ARDUINO_CORE;
    if (!coreDir) {
        return { ok: false, backend: 'avr-gcc', output: 'no compiler: install arduino-cli, or set ROBOLANCE_ARDUINO_CORE to an ArduinoCore-avr checkout with gcc-avr installed' };
    }
    const core = join(coreDir, 'cores', 'arduino');
    const variant = join(coreDir, 'variants', 'standard');
    const includes = ['-I', core, '-I', variant];
    const libDirs = options.libraryDirs ?? libraryDirsFromEnv();
    const libraries = await librariesFor(sketch, libDirs);
    for (const lib of libraries) {
        includes.push('-I', lib.srcDir);
        for (const extra of lib.extraIncludeDirs) {
            includes.push('-I', extra);
        }
    }
    const cFlags = ['-c', '-g', '-Os', '-w', '-std=gnu11', '-ffunction-sections', '-fdata-sections', '-flto', '-fno-fat-lto-objects', `-mmcu=${MCU}`, ...COMMON_DEFINES, ...includes];
    const cppFlags = ['-c', '-g', '-Os', '-w', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-ffunction-sections', '-fdata-sections', '-fno-threadsafe-statics', '-Wno-error=narrowing', '-flto', `-mmcu=${MCU}`, ...COMMON_DEFINES, ...includes];

    const sketchCpp = join(dir, 'sketch.cpp');
    await writeFile(sketchCpp, withPrototypes(sketch));
    const objects: string[] = [];
    const messages: string[] = [];

    // The sketch first: its errors are what the agent needs to read.
    const sketchObj = join(dir, 'sketch.o');
    const sketchResult = await compile('avr-g++', [...cppFlags, sketchCpp, '-o', sketchObj]);
    if (!sketchResult.ok) {
        return { ok: false, backend: 'avr-gcc', output: tidy(sketchResult.output.replaceAll(sketchCpp, 'sketch.ino')) };
    }
    objects.push(sketchObj);
    if (sketchResult.output.trim()) {
        messages.push(sketchResult.output);
    }

    const sources = [
        ...await sourceFiles(core),
        ...(await Promise.all(libraries.map(lib => lib.sourceFiles()))).flat(),
    ];
    for (const source of sources) {
        const obj = join(dir, createHash('sha1').update(source).digest('hex').slice(0, 12) + '.o');
        if (await exists(obj)) {
            objects.push(obj);
            continue;
        }
        const isC = source.endsWith('.c');
        const isAsm = source.endsWith('.S');
        const asmFlags = ['-c', '-g', '-x', 'assembler-with-cpp', '-flto', `-mmcu=${MCU}`, ...COMMON_DEFINES, ...includes];
        const result = isAsm
            ? await compile('avr-gcc', [...asmFlags, source, '-o', obj])
            : await compile(isC ? 'avr-gcc' : 'avr-g++', [...(isC ? cFlags : cppFlags), source, '-o', obj]);
        if (!result.ok) {
            return { ok: false, backend: 'avr-gcc', output: tidy(`while compiling ${source}:\n${result.output}`) };
        }
        objects.push(obj);
    }

    const elf = join(dir, 'sketch.elf');
    const link = await compile('avr-gcc', ['-w', '-Os', '-g', '-flto', '-fuse-linker-plugin', '-Wl,--gc-sections', `-mmcu=${MCU}`, '-o', elf, ...objects, '-lm']);
    if (!link.ok) {
        return { ok: false, backend: 'avr-gcc', output: tidy(link.output) };
    }
    const hexPath = join(dir, 'sketch.hex');
    const objcopy = await compile('avr-objcopy', ['-O', 'ihex', '-R', '.eeprom', elf, hexPath]);
    if (!objcopy.ok) {
        return { ok: false, backend: 'avr-gcc', output: tidy(objcopy.output) };
    }
    const size = await compile('avr-size', ['-A', elf]);
    return {
        ok: true,
        backend: 'avr-gcc',
        hex: await readFile(hexPath, 'utf8'),
        output: tidy(messages.join('\n')),
        size: size.ok ? parseAvrSize(size.output) : undefined,
    };
}

interface Library {
    name: string;
    srcDir: string;
    extraIncludeDirs: string[];
    sourceFiles(): Promise<string[]>;
}

/** The libraries the sketch includes that exist under `libDirs` (name = folder name, Arduino style). */
async function librariesFor(sketch: string, libDirs: string[]): Promise<Library[]> {
    const wanted = new Set<string>();
    for (const m of sketch.matchAll(/^\s*#include\s*[<"]([^>"]+)\.h[>"]/gm)) {
        wanted.add(m[1]);
    }
    const found: Library[] = [];
    for (const name of wanted) {
        for (const base of libDirs) {
            const root = join(base, name);
            const srcDir = await exists(join(root, 'src')) ? join(root, 'src') : root;
            if (!await exists(join(srcDir, `${name}.h`))) {
                continue;
            }
            const avrDir = join(srcDir, 'avr');
            const extraIncludeDirs = await exists(avrDir) ? [avrDir] : [];
            found.push({
                name,
                srcDir,
                extraIncludeDirs,
                sourceFiles: async () => [...await sourceFiles(srcDir), ...(await exists(avrDir) ? await sourceFiles(avrDir) : [])],
            });
            break;
        }
    }
    return found;
}

async function sourceFiles(dir: string): Promise<string[]> {
    const names = await readdir(dir);
    return names.filter(n => /\.(c|cpp|S)$/.test(n)).map(n => join(dir, n)).sort();
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function libraryDirsFromEnv(): string[] {
    return (process.env.ROBOLANCE_ARDUINO_LIBS ?? '').split(':').filter(Boolean).map(p => resolve(p));
}

async function compile(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
    try {
        const { stdout, stderr } = await run(cmd, args, { maxBuffer: 16 << 20 });
        return { ok: true, output: stderr + stdout };
    } catch (err) {
        return { ok: false, output: errorOutput(err) };
    }
}

function errorOutput(err: unknown): string {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    return [e.stderr, e.stdout].filter(Boolean).join('\n') || e.message || String(err);
}

function tidy(text: string): string {
    return text.replace(/\r/g, '').split('\n').filter(l => l.trim()).join('\n').slice(0, 20_000);
}

/**
 * The Arduino IDE adds `#include <Arduino.h>` and a prototype for every
 * function so sketches can call functions defined later. This does the
 * same for the common case: one-line signatures at the left margin.
 */
export function withPrototypes(sketch: string): string {
    const prototypes: string[] = [];
    const seen = new Set<string>();
    const stripped = sketch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of stripped.matchAll(/^([A-Za-z_][\w:<>,\s*&]*?)\s+\*?([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*\{/gm)) {
        const [, type, name, params] = m;
        const head = type.trim();
        if (/^(if|for|while|switch|else|return|do|case)$/.test(head) || /\b(if|for|while|switch|else|return)\b/.test(head)) {
            continue;
        }
        if (name === 'setup' || name === 'loop' || seen.has(name) || /^(class|struct|enum)\b/.test(head)) {
            continue;
        }
        seen.add(name);
        prototypes.push(`${head} ${name}(${params.trim()});`);
    }
    const lines = sketch.split('\n');
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*#/.test(lines[i])) {
            insertAt = i + 1;
        }
    }
    lines.splice(insertAt, 0, '#include <Arduino.h>', ...prototypes);
    return lines.join('\n') + '\n';
}

function parseAvrSize(output: string): { flashBytes: number; ramBytes: number } | undefined {
    const section = (name: string): number => {
        const m = output.match(new RegExp(`^${name}\\s+(\\d+)`, 'm'));
        return m ? Number(m[1]) : 0;
    };
    const text = section('.text');
    const data = section('.data');
    const bss = section('.bss');
    if (!text && !data) {
        return undefined;
    }
    return { flashBytes: text + data, ramBytes: data + bss };
}

function parseCliSize(output: string): { flashBytes: number; ramBytes: number } | undefined {
    const flash = output.match(/Sketch uses (\d+) bytes/);
    const ram = output.match(/Global variables use (\d+) bytes/);
    return flash && ram ? { flashBytes: Number(flash[1]), ramBytes: Number(ram[1]) } : undefined;
}
