import { describe, expect, it, vi } from "vite-plus/test";
import {
  defineApp,
  defineConfig,
  defineProvider,
  defineRepo,
  defineRuntime,
  defineService,
  defineSingleton,
  defineType,
  defineUIComponent,
  defineUIHook,
  defineUtil,
} from "./define.ts";

describe("definitions", () => {
  it("defines type, config, and utility values without changing their shape", () => {
    const parser = defineType({ parse: (value: string) => value.trim() });
    const config = defineConfig({ port: 3333 } as const);
    const util = defineUtil({ double: (value: number) => value * 2 });

    expect(parser.parse(" value ")).toBe("value");
    expect(config.port).toBe(3333);
    expect(util.double(3)).toBe(6);
  });

  it("defines classes with defaults and replacement construction props", () => {
    class Formatter extends defineService({
      params: { prefix: "production" },
      deps: { uppercase: (value: string) => value.toUpperCase() },
    }) {
      public format(props: { value: string }): string {
        return `${this.params.prefix}:${this.deps.uppercase(props.value)}`;
      }
    }

    expect(new Formatter().format({ value: "value" })).toBe("production:VALUE");
    expect(
      new Formatter({
        params: { prefix: "test" },
        deps: { uppercase: (value) => value },
      }).format({ value: "value" }),
    ).toBe("test:value");
  });

  it("defines singletons whose methods use params and deps through this", () => {
    const Singleton = defineSingleton({
      params: { prefix: "production" },
      deps: { uppercase: (value: string) => value.toUpperCase() },
      format(props: { value: string }) {
        return `${this.params.prefix}:${this.deps.uppercase(props.value)}`;
      },
    });

    expect(Singleton.format({ value: "value" })).toBe("production:VALUE");
  });

  it("defines hooks whose implementation uses params and deps through this", () => {
    const useValue = defineUIHook({
      params: { prefix: "production" },
      deps: { uppercase: (value: string) => value.toUpperCase() },
      hook(props: { value: string }) {
        return `${this.params.prefix}:${this.deps.uppercase(props.value)}`;
      },
    });

    expect(useValue({ value: "value" })).toBe("production:VALUE");
  });

  it("defines components whose implementation receives props", () => {
    const Message = defineUIComponent({
      params: { prefix: "production" },
      deps: { uppercase: (value: string) => value.toUpperCase() },
      component(props: { message: string }) {
        return `${this.params.prefix}:${this.deps.uppercase(props.message)}`;
      },
    });

    expect(Message({ message: "value" })).toBe("production:VALUE");
  });

  it("runs entrypoints with params and deps on this", async () => {
    const execute = vi.fn(async function execute(value: string) {
      return value.toUpperCase();
    });

    const result = await defineApp({
      params: { value: "lgtm" },
      deps: { execute },
      async run() {
        return await this.deps.execute(this.params.value);
      },
    });

    expect(result).toBe("LGTM");
    expect(execute).toHaveBeenCalledWith("lgtm");
  });

  it("defines constructable repository, runtime, and provider layers", () => {
    class Repository extends defineRepo({ params: { value: "repo" }, deps: {} }) {
      public read(): string {
        return this.params.value;
      }
    }
    class Runtime extends defineRuntime({ params: { value: "runtime" }, deps: {} }) {
      public run(): string {
        return this.params.value;
      }
    }
    class Provider extends defineProvider({ params: { value: "provider" }, deps: {} }) {
      public provide(): string {
        return this.params.value;
      }
    }

    expect(new Repository().read()).toBe("repo");
    expect(new Runtime().run()).toBe("runtime");
    expect(new Provider().provide()).toBe("provider");
  });
});
