export abstract class DomainClass<Params, Deps> {
  public constructor(
    protected readonly params: Params,
    protected readonly deps: Deps,
  ) {}
}
