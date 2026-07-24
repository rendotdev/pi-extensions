export type SSHProcessResult = {
  stdout: Buffer;
  stderr: string;
  code: number | null;
};

export type SSHControlConnection = {
  destination: string;
  socketDirectory: string;
  socketPath: string;
};
