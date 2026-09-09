class StubFile {
  exists = false;
  uri = "file:///mock/path";
  name = "mock-file";
  constructor(...parts: unknown[]) {
    this.name =
      parts.length > 1 && typeof parts[1] === "string" ? parts[1] : "mock-file";
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

class StubDirectory {
  uri = "file:///mock/directory";
  constructor(..._parts: unknown[]) {}
  list(): Array<{ name: string; delete(): void }> {
    return [];
  }
}

export const File = StubFile;
export const Directory = StubDirectory;
export const Paths = { document: {} };
