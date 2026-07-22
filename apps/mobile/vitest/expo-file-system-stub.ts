class StubFile {
  exists = false;
  constructor(..._parts: unknown[]) {}
  async text(): Promise<string> {
    return "";
  }
  write(_content: string): void {
    this.exists = true;
  }
  delete(): void {
    this.exists = false;
  }
}

export const File = StubFile;
export const Paths = { document: {} };
