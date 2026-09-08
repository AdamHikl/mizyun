class StubFile {
  exists = false;
  uri = "file:///mock/path";
  constructor(...parts: unknown[]) {
    if (parts.length > 1 && typeof parts[1] === "string") {
      this.uri = `file:///mock/${parts[1]}`;
    }
  }
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
