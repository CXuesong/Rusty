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

export interface SpecializedCreepType<TState extends Record<string, any> = {}> {
    readonly rustyType: string;
    readonly spawn: (spawn: StructureSpawn) => string | SpecializedSpawnCreepErrorCode;
    new(id: Id<Creep>): SpecializedCreepBase<TState>;
}

export function isSpecializedCreepOf(creep: Creep, type: SpecializedCreepType): boolean {
    return creep.memory?.rustyType === type.rustyType;
}

export function enumSpecializedCreeps<T extends SpecializedCreepType>(type?: T, room?: Room): _.Collection<InstanceType<T>> {
    let result = room ? _(room.find(FIND_MY_CREEPS)) : _(Game.creeps).values();
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
    private readonly _name: string;
    private _stateReplicate: TState;
    public constructor(public readonly id: Id<Creep>) {
        if (!id) throw new TypeError("Creep id is falsy.");
        const c = this.creep;
        this._name = c.name;
        this._stateReplicate = c.memory.rusty as TState;
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
    public get state(): TState {
        const c = Game.getObjectById(this.id);
        return c ? c.memory.rusty as TState : this._stateReplicate;
    }
    public set state(value: TState) {
        // Makes sure underlying Creep exists.
        this.creep.memory.rusty = this.onStateRootChanging(value);
    }
    public get disposed(): boolean {
        return this._disposed;
    }
    public nextFrame(): void {
        try {
            this.onNextFrame();
        } finally {
            this._stateReplicate = this.creep.memory.rusty as TState;
        }
    }
    protected abstract onNextFrame(): void;
    protected onStateRootChanging(newState: TState): TState {
        return newState;
    }
    /** Called before creep terminates. */
    public dispose(): void {
        if (this._disposed) return;
        // Underlying creep instance may have already gone.
        logger.info(`Dispose specialized creep: ${this._name}.`)
        delete Memory.creeps[this._name];
        this._disposed = true;
    }
}
