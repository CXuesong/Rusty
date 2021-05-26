export type SpecializedSpawnCreepErrorCode = Exclude<ScreepsReturnCode, OK | ERR_NAME_EXISTS>;

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
    new(creep: Creep) : SpecializedCreepBase<any>;
}

export function isSpecializedCreepOf(creep: Creep, type: SpecializedCreepType): boolean {
    return creep.memory?.rustyType === type.rustyType;
}

export abstract class SpecializedCreepBase<TState extends Record<string, any> = {}> {
    public static readonly rustyType: string;
    public static readonly spawn: (spawn: StructureSpawn) => string | SpecializedSpawnCreepErrorCode;
    public constructor(public readonly creep: Creep) {
        if (!creep) throw new TypeError("creep is falsy.");
        if (!creep.memory) throw new TypeError("creep.memory is falsy.");
    }
    public get id(): string {
        return this.creep.name;
    }
    public get state(): TState {
        return this.creep.memory.rusty as TState;
    }
    public abstract nextFrame(): void;
}
