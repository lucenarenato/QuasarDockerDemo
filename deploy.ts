import { spawn, ChildProcess } from 'child_process';

type StdIn = ChildProcess['stdin'];
type StdOut = ChildProcess['stdout'];
type StdErr = ChildProcess['stderr'];
type StdIoType = 'inherit' | 'pipe';

async function exec({
  command,
  stdio = 'inherit',
}: {
  command: string;
  stdio?:
    | StdIoType
    | [StdIoType?, StdIoType?, StdIoType?]
    | ((stdin: StdIn, stdout: StdOut, stderr: StdErr) => Promise<void> | void);
}): Promise<{ output: string[]; error: string[] }> {
  return new Promise(async (resolve) => {
    const [text, ...args] = command.split(' ');
    console.log(command);

    const process = spawn(text, args, {
      stdio:
        typeof stdio === 'function'
          ? ['pipe', 'pipe', 'pipe']
          : Array.isArray(stdio)
          ? [
              stdio.length > 0 && stdio[0] ? stdio[0] : 'inherit',
              stdio.length > 1 && stdio[1] ? stdio[1] : 'inherit',
              stdio.length > 2 && stdio[2] ? stdio[2] : 'inherit',
            ]
          : stdio,
    });
    const [stdin, stdout, stderr] = process.stdio;
    if (stdout) stdout.setEncoding('utf8');
    if (stderr) stderr.setEncoding('utf8');

    let output = '';
    let error = '';
    if (stdin && stdout && stderr && typeof stdio === 'function') {
      const task = stdio(stdin, stdout, stderr);
      if (task) await task;
    } else if (typeof stdio === 'object') {
      if (stdout) {
        stdout.on('data', function (data) {
          output += data;
        });
      }
      if (stderr) {
        stderr.on('data', function (data) {
          error += data;
        });
      }
    }
    process.on('close', () => {
      resolve({
        output:
          output
            ?.split('\n')
            .map((line) => line.trim())
            .filter((line) => line) || [],
        error:
          error
            ?.split('\n')
            .map((line) => line.trim())
            .filter((line) => line) || [],
      });
    });
  });
}

async function getImageId({ image }: { image: string }) {
  const {
    output: [id],
  } = await exec({
    command: `docker image ls -q ${image}`,
    stdio: [, 'pipe'],
  });
  return id;
}

const registry = 'docker.test.tobiasmesquita.dev';
const tmpl = {
  tag: 'docker tag {source} {target}',
  push: 'docker push {target}',
};
async function dockerCmd({
  cmd,
  image,
  id,
  version,
  previous,
}: {
  cmd: 'tag' | 'push';
  image: string;
  id: string;
  version: string;
  previous?: string;
}) {
  const latestTag = `${registry}/${image}:latest`;
  const versionTag = `${registry}/${image}:${version}`;
  if (previous) {
    const previousTag = `${registry}/${image}:${previous}`;
    await exec({
      command: tmpl[cmd]
        .replace('{source}', latestTag)
        .replace('{target}', previousTag),
    });
  }
  await exec({
    command: tmpl[cmd].replace('{source}', id).replace('{target}', versionTag),
  });
  await exec({
    command: tmpl[cmd]
      .replace('{source}', versionTag)
      .replace('{target}', latestTag),
  });
}

async function main({
  service,
  image,
  previous,
}: {
  service: string;
  image: string;
  previous?: string;
}) {
  await exec({ command: 'yarn version --patch' });
  const packageJson = await import('./package.json');
  const version = packageJson.version;

  await exec({
    command: `docker compose -f docker-compose.yml -f docker-compose.build.yml build ${service}`,
  });
  const id = await getImageId({ image });
  await dockerCmd({ cmd: 'tag', image, id, version, previous });
  await dockerCmd({ cmd: 'push', image, id, version, previous });
}

const sIndex = process.argv.findIndex(
  (arg) => arg.startsWith('--service') || arg.startsWith('-s')
);
const iIndex = process.argv.findIndex(
  (arg) => arg.startsWith('--image') || arg.startsWith('-i')
);
const pIndex = process.argv.findIndex((arg) => arg.startsWith('--previous'));
if (sIndex !== -1 && iIndex !== -1) {
  const service = process.argv[sIndex].split('=')[1];
  const image = process.argv[iIndex].split('=')[1];
  const previous =
    pIndex !== -1 ? process.argv[pIndex].split('=')[1] : undefined;
  main({ service, image, previous });
}
