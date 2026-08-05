import {
    accessSync,
    constants as fsConstants,
    existsSync,
    readFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';

const LOCAL_PYTHON_BINARY = join(process.cwd(), '.venv', 'bin', 'python');

export function findExecutable(command: string): string | undefined {
    const pathDirectories = process.env['PATH']?.split(delimiter) ?? [];

    for (const directory of pathDirectories) {
        const executablePath = join(directory, command);

        try {
            accessSync(executablePath, fsConstants.X_OK);
            return executablePath;
        } catch {
            continue;
        }
    }

    return undefined;
}

export function resolvePythonBinaryFromPip(
    command: string,
): string | undefined {
    const pipPath = findExecutable(command);

    if (!pipPath) {
        return undefined;
    }

    const [firstLine] = readFileSync(pipPath, 'utf8').split('\n');
    const shebang = firstLine?.startsWith('#!')
        ? firstLine.slice(2).trim()
        : undefined;

    if (!shebang) {
        return undefined;
    }

    const [executable, ...args] = shebang.split(/\s+/);

    if (!executable) {
        return undefined;
    }

    if (executable.endsWith('/env')) {
        return args[0];
    }

    return executable;
}

export function resolvePythonBinary(): string {
    return (
        process.env['PYTHON'] ??
        (existsSync(LOCAL_PYTHON_BINARY) ? LOCAL_PYTHON_BINARY : undefined) ??
        resolvePythonBinaryFromPip('pip') ??
        resolvePythonBinaryFromPip('pip3') ??
        'python3'
    );
}
