import type { ReactNode } from "react";

export type DefinitionProps<Params extends object, Deps extends object> = Readonly<{
  params: Readonly<Params>;
  deps: Readonly<Deps>;
}>;

type DefinitionContext<Params extends object, Deps extends object> = Readonly<{
  params: Readonly<Params>;
  deps: Readonly<Deps>;
}>;

type PublicDependency<Value> = Value extends (...params: never[]) => unknown
  ? Value
  : Value extends object
    ? { readonly [Key in keyof Value]: Value[Key] }
    : Value;

type PublicDependencies<Deps extends object> = {
  readonly [Key in keyof Deps]: PublicDependency<Deps[Key]>;
};

function defineValue<Definition>(definition: Definition): Definition {
  return definition;
}

export function defineType<Definition>(definition: Definition): Definition {
  return defineValue(definition);
}

export function defineConfig<Definition>(definition: Definition): Definition {
  return defineValue(definition);
}

export function defineUtil<Definition>(definition: Definition): Definition {
  return defineValue(definition);
}

function defineConstructable<Params extends object, Deps extends object>(
  defaults: DefinitionProps<Params, Deps>,
) {
  type Props = DefinitionProps<Params, PublicDependencies<Deps>>;
  const publicDefaults = defaults as Props;

  return class DefinedClass {
    protected readonly params: Readonly<Params>;
    protected readonly deps: Readonly<PublicDependencies<Deps>>;

    public constructor(props: Props = publicDefaults) {
      this.params = props.params;
      this.deps = props.deps;
    }
  };
}

export function defineRepo<Params extends object, Deps extends object>(
  defaults: DefinitionProps<Params, Deps>,
) {
  return defineConstructable(defaults);
}

export function defineService<Params extends object, Deps extends object>(
  defaults: DefinitionProps<Params, Deps>,
) {
  return defineConstructable(defaults);
}

export function defineRuntime<Params extends object, Deps extends object>(
  defaults: DefinitionProps<Params, Deps>,
) {
  return defineConstructable(defaults);
}

export function defineProvider<Params extends object, Deps extends object>(
  defaults: DefinitionProps<Params, Deps>,
) {
  return defineConstructable(defaults);
}

export function defineSingleton<
  Params extends object,
  Deps extends object,
  Definition extends object,
>(
  definition: Definition &
    DefinitionProps<Params, Deps> &
    ThisType<DefinitionContext<Params, Deps>>,
): Omit<Definition, "params" | "deps"> {
  return definition;
}

export function defineUIHook<Params extends object, Deps extends object, Props, Output>(
  definition: DefinitionProps<Params, Deps> & {
    hook(props: Props): Output;
  } & ThisType<DefinitionContext<Params, Deps>>,
): (props: Props) => Output {
  return function definedHook(props: Props): Output {
    return definition.hook.call(definition, props);
  };
}

export function defineUIComponent<
  Params extends object,
  Deps extends object,
  Props extends object,
  Output extends ReactNode,
>(
  definition: DefinitionProps<Params, Deps> & {
    component(props: Props): Output;
  } & ThisType<DefinitionContext<Params, Deps>>,
): (props: Props) => Output {
  return function DefinedComponent(props: Props): Output {
    return definition.component.call(definition, props);
  };
}

export function defineApp<Params extends object, Deps extends object, Output>(
  definition: DefinitionProps<Params, Deps> & {
    run(): Output;
  } & ThisType<DefinitionContext<Params, Deps>>,
): Output {
  return definition.run.call(definition);
}
