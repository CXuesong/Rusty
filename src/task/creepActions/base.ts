export type CreepActionNextFrameResult = "yield" | "complete" | "cancelled";

export abstract class CreepActionBase {
    private readonly _name: string;
    public constructor(public readonly id: Id<Creep>) {
        if (!id) throw new TypeError("Creep id is falsy.");
        const c = this.creep;
        this._name = c.name;
    }
    public get creep(): Creep {
        const inst = Game.getObjectById(this.id);
        if (!(inst instanceof Creep)) throw new Error(`Unexpected underlying Creep instance: ${inst}.`);
        if (this._name != null && inst.name !== this._name) throw new Error(`Unexpected underlying Creep name: ${inst}. Expected: ${this._name}.`);
        return inst;
    }
    public get name(): string {
        return this._name;
    }
    public abstract nextFrame(): CreepActionNextFrameResult;
    public detach(): void {
    }
}
