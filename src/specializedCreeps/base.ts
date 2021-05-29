import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { getSpecializedCreep } from "./registry";

export type SpecializedSpawnCreepErrorCode = Exclude<ScreepsReturnCode, OK | ERR_NAME_EXISTS>;

const logger = new Logger("Rusty.SpecializedCreeps.SpecializedCreepBase");

export function stateFromCreep<TState extends Record<string, any> = {}>(creep: Creep) {
    if (!creep) throw new TypeError("creep is falsy.");
    if (!creep.memory) throw new TypeError("creep.memory is falsy.");
    if (!creep.memory.rusty) throw new TypeError("creep.memory.rusty is falsy.");
    return creep.memory.rusty as TState
}

export function buildCreepMemory<TState extends Record<string, any> = {}>(rustyType: string, state: TState): CreepMemory {
    return {
        rustyType,
        rusty: state
    };
}

export interface SpecializedCreepType {
    readonly rustyType: string;
    readonly spawn: (spawn: StructureSpawn) => string | SpecializedSpawnCreepErrorCode;
    new(id: Id<Creep>): SpecializedCreepBase<any>;
}

export function isSpecializedCreepOf(creep: Creep, type: SpecializedCreepType): boolean {
    return creep.memory?.rustyType === type.rustyType;
}

export function enumSpecializedCreeps<T extends SpecializedCreepType>(type?: T): Iterable<InstanceType<T>> {
    let result = _(Game.creeps).values();
    if (type)
        return result
            .map(c => (isSpecializedCreepOf(c, type) && getSpecializedCreep(c)) as InstanceType<T>)
            .filter(c => !!c);
    else
        return result
            .map(c => (getSpecializedCreep(c)) as InstanceType<T>)
            .filter(c => !!c);
}

export abstract class SpecializedCreepBase<TState extends Record<string, any> = {}> {
    public static readonly rustyType: string;
    public static readonly spawn: (spawn: StructureSpawn) => string | SpecializedSpawnCreepErrorCode;
    private _disposed = false;
    public constructor(public readonly id: Id<Creep>) {
        if (!id) throw new TypeError("creep is falsy.");
        void (this.creep);
    }
    public get creep(): Creep{
        const inst = Game.getObjectById(this.id);
        if (!(inst instanceof Creep)) throw new Error(`Unexpected underlying Creep instance: ${inst}.`);
        return inst;
    }
    public get name(): string {
        return this.creep.name;
    }
    public get state(): TState {
        return this.creep.memory.rusty as TState;
    }
    public set state(value: TState) {
        this.creep.memory.rusty = this.onStateRootChanging(value);
    }
    public get disposed(): boolean {
        return this._disposed;
    }
    public abstract nextFrame(): void;
    protected onStateRootChanging(newState: TState): TState {
        return newState;
    }
    /** Called before creep terminates. */
    public dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        logger.info(`Dispose specialized creep: ${this.creep}.`)
        delete Memory.creeps[this.creep.name];
    }
}
