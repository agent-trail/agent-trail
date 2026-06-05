export type TerminalIo = {
  isTTY?: boolean;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  width?: number;
  height?: number;
};
