import _ from "lodash/index";
import { evadeHostileCreeps } from "src/utility/costMatrix";
import { Logger } from "src/utility/logger";
import { enumSpecializedCreeps, SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "./base";
import { initializeCreepMemory, spawnCreep } from "./spawn";

interface CollectorCreepStateBase {
    mode: string;
    dullTicks?: number;
    isWalking?: boolean;
}

interface CollectorCreepStateIdle extends CollectorCreepStateBase {
    mode: "idle";
}

interface CollectorCreepStateCollect extends CollectorCreepStateBase {
    mode: "collect";
    destId: string;
}

interface CollectorCreepStateCollectSource extends CollectorCreepStateCollect {
    sourceId: Id<Source>;
}

interface CollectorCreepStateCollectTombstone extends CollectorCreepStateCollect {
    tombstoneId: Id<Tombstone>;
}

interface CollectorCreepStateDistributeSpawn extends CollectorCreepStateBase {
    mode: "distribute-spawn";
    spawnId: Id<StructureSpawn>;
}

interface CollectorCreepStateDistributeController extends CollectorCreepStateBase {
    mode: "distribute-controller";
    controllerId: Id<StructureController>;
}

type CollectorCreepState
    = CollectorCreepStateIdle
    | CollectorCreepStateCollectSource
    | CollectorCreepStateCollectTombstone
    | CollectorCreepStateDistributeSpawn
    | CollectorCreepStateDistributeController;

let occupiedTombstones: Map<Id<Tombstone>, Id<Creep>> | undefined;

function getTombstoneCollector(id: Id<Tombstone>): Id<Creep> | undefined {
    if (!occupiedTombstones) {
        occupiedTombstones = new Map();
        for (const c of enumSpecializedCreeps(CollectorCreep)) {
            if (c.state.mode === "collect" && "tombstoneId" in c.state) {
                occupiedTombstones.set(c.state.tombstoneId, c.id);
            }
        }
    }
    return occupiedTombstones.get(id);
}

function declareTombstoneCollector(id: Id<Tombstone>, collector?: Id<Creep>): void {
    if (!occupiedTombstones) return;
    if (collector)
        occupiedTombstones.set(id, collector);
    else
        occupiedTombstones.delete(id);
}

export class CollectorCreep extends SpecializedCreepBase<CollectorCreepState> {
    public static readonly rustyType = "collector";
    private logger = new Logger(`Rusty.SpecializedCreeps.CollectorCreep.#${this.creep.name}`);
    public static spawn(spawn: StructureSpawn): string | SpecializedSpawnCreepErrorCode {
        const name = spawnCreep(spawn, {
            [CARRY]: 2,
            [MOVE]: 2,
            [WORK]: 1,
        });
        if (typeof name === "string") {
            initializeCreepMemory<CollectorCreepState>(name, CollectorCreep.rustyType, { mode: "idle" });
        }
        return name;
    }
    public nextFrame(): void {
        const { state } = this;
        switch (state.mode) {
            case "collect":
                this.nextFrameCollect();
                break;
            case "distribute-spawn":
                this.nextFrameDistributeSpawn();
                break;
            case "distribute-controller":
                this.nextFrameDistributeController();
                break;
            default:
                this.transitCollect();
                break;
        }
    }
    protected onStateRootChanging(newState: CollectorCreepState): CollectorCreepState {
        const { creep, state } = this;
        if (newState.mode !== state.mode) {
            creep.say(newState.mode.split("-").map(s => s.substr(4)).join("-"));
            this.logger.info(`Switch mode: ${state.mode} -> ${newState.mode}.`);
        }
        return newState;
    }
    private tickDull(): boolean {
        const { state } = this;
        state.dullTicks = (state.dullTicks || _.random(2, 10)) - 1;
        if (state.dullTicks <= 0) {
            state.dullTicks = undefined;
            return false;
        }
        return true;
    }
    private transitCollect(): boolean {
        const { creep, state } = this;
        const currentDest = state.mode === "collect" ? state.destId : undefined;
        // Collect tombstone (in current room) first.
        const tombstone = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
            filter: t => t.store.energy >= 10 && t.ticksToDecay >= 3 && (getTombstoneCollector(t.id) ?? this === this),
            maxRooms: 1,
            costCallback: (roomName, cost) => {
                const room = Game.rooms[roomName];
                if (!room) {
                    this.logger.warning(`Unable to check room ${roomName}.`);
                    return;
                }
                const tombstones = room.find(FIND_TOMBSTONES);
                for (const ts of tombstones) {
                    let c: number | undefined;
                    if (ts.id === currentDest) c = -100;
                    else if (ts.store.energy <= 20) c = 50;
                    else if (ts.store.energy <= 50) c = 10;
                    else c = undefined;
                    if (c != null) cost.set(ts.pos.x, ts.pos.y, c);
                }
                // Evade hostile creeps.
                evadeHostileCreeps(room, cost);
            }
        });
        if (tombstone) {
            this.logger.info(`Collect ${tombstone}.`);
            this.state = { mode: "collect", tombstoneId: tombstone.id, destId: tombstone.id };
            declareTombstoneCollector(tombstone.id, this.id);
            return true;
        }
        // Then collect energy source.
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, {
            maxRooms: 4,
            costCallback: (roomName, cost) => {
                const room = Game.rooms[roomName];
                if (!room) {
                    this.logger.warning(`Unable to check room ${roomName}.`);
                    return;
                }
                const sources = room.find(FIND_SOURCES_ACTIVE);
                for (const s of sources) {
                    let c: number | undefined;
                    if (s.id === currentDest) c = -100;
                    else if (s.energy <= 2) c = 255;
                    else if (s.energy <= 20) c = 50;
                    else if (s.energy <= 50) c = 30;
                    else if (s.energy <= 100) c = 20;
                    else c = undefined;
                    if (c != null) cost.set(s.pos.x, s.pos.y, c);
                }
                // Evade hostile creeps.
                evadeHostileCreeps(room, cost);
            }
        });
        if (source) {
            this.logger.info(`Collect ${source}.`);
            this.state = { mode: "collect", sourceId: source.id, destId: source.id };
            return true;
        }
        return false;
    }
    private transitDistribute(): boolean {
        const { creep, state } = this;
        const { controller } = creep.room;
        if (state.mode === "distribute-controller") {
            if (controller?.my) return true;
        } else if (state.mode === "distribute-spawn") {
            const s = Game.getObjectById(state.spawnId);
            if (s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) return true;
        }
        let controllerPriority = 0.3;
        if (controller?.my) {
            if (controller.ticksToDowngrade <= 500) {
                // Resetting downgrade timer is priority.
                controllerPriority = 1;
            }
        }
        if (controllerPriority < 1 && _.random(true) > controllerPriority) {
            const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS, {
                filter: s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
                // costCallback: (roomName, cost) => {
                //     const room = Game.rooms[roomName];
                //     if (!room) {
                //         this.logger.warning(`transitDistribute: Unable to check room ${roomName}.`);
                //         return;
                //     }
                // }
            });
            if (spawn) {
                this.state = { mode: "distribute-spawn", spawnId: spawn.id };
                return true;
            }
        }
        if (controller?.my) {
            this.state = { mode: "distribute-controller", controllerId: controller.id }
            return true;
        }
        return false;
    }
    private checkEnergyConstraint(): boolean {
        const { creep, state } = this;
        switch (state.mode) {
            case "collect":
                if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    this.transitDistribute();
                    return false;
                }
                return true;
            case "distribute-controller":
            case "distribute-spawn":
                if (!creep.store.energy) {
                    this.transitCollect();
                    return false;
                }
                return true;
            default:
                throw new Error("Invalid state.");
        }
    }
    // private tryTransferEnergy(): boolean {
    //     const { creep } = this;
    //     const myEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    //     if (!myEnergy) return false;
    //     const targets = creep.pos.findInRange(FIND_MY_CREEPS, 1, { filter: c => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 });
    //     const target = _(targets)
    //         .map(c => getSpecializedCreep(c))
    //         .filter(c => !!c)
    //         .minBy(c => {
    //             // Only transfer energy to walking creeps.
    //             if (c instanceof CollectorCreep && c.state.isWalking)
    //                 return c.creep.store.getFreeCapacity(RESOURCE_ENERGY);
    //             return undefined;
    //         });
    //     if (target) {
    //         const result = creep.transfer(target.creep, RESOURCE_ENERGY);
    //         this.logger.info(`tryTransferEnergy: creep.transfer(${target.creep}) -> ${result}.`);
    //         return result === OK;
    //     }
    //     return false;
    // }
    private nextFrameCollect(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "collect") throw new Error("Invalid state.");
        let result;
        let dest;
        if ("tombstoneId" in state) {
            const tombstone = dest = Game.getObjectById(state.tombstoneId);
            result = tombstone ? creep.withdraw(tombstone, RESOURCE_ENERGY) : undefined;
            this.logger.trace(`nextFrameCollect: creep.withdraw -> ${result}.`);
        } else {
            const source = dest = Game.getObjectById(state.sourceId);
            result = source ? creep.harvest(source) : undefined;
            this.logger.trace(`nextFrameCollect: creep.harvest -> ${result}.`);
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE) {
            if (dest) creep.moveTo(dest);
            if (this.tickDull()) return;
            // Recheck nearest source.
            if (!this.transitCollect()) {
                if (creep.store.energy > 0) {
                    this.transitDistribute();
                    return;
                }
                creep.say("Idle");
                this.logger.warning("nextFrameCollect: Nothing to do.");
                return;
            }
        } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
            if (dest instanceof Source && dest.ticksToRegeneration > 10)
                creep.say("Wait Regn");
            else
                this.transitCollect();
        }
    }
    private nextFrameDistributeSpawn(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "distribute-spawn") throw new Error("Invalid state.");
        const spawn = state.spawnId && Game.getObjectById(state.spawnId);
        const transferResult = spawn && creep.transfer(spawn, RESOURCE_ENERGY);
        state.isWalking = transferResult === ERR_NOT_IN_RANGE;
        this.logger.trace(`nextFrameDistributeSpawn: creep.transfer(${spawn}) -> ${transferResult}.`);
        if (!spawn || transferResult === ERR_NOT_IN_RANGE) {
            if (spawn) creep.moveTo(spawn);
            if (this.tickDull()) return;
            // Recheck nearest spawn / controller.
            if (!this.transitDistribute()) {
                if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                    this.transitCollect();
            }
            return;
        } else if (transferResult === ERR_FULL) {
            if (!this.transitDistribute()) {
                if (this.tickDull()) return;
                if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
                    this.transitCollect();
            }
        }
    }
    private nextFrameDistributeController(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "distribute-controller") throw new Error("Invalid state.");
        let controller = state.controllerId && Game.getObjectById(state.controllerId) || creep.room.controller;
        if (!controller?.my) {
            // Waiting will not help.
            if (creep.store.energy >= creep.store.getCapacity(RESOURCE_ENERGY) / 4 && this.transitDistribute())
                return;
            this.transitCollect();
            return;
        }
        const result = creep.upgradeController(controller);
        this.logger.trace(`nextFrameDistributeController: creep.upgradeController(${controller}) -> ${result}.`);
        switch (result) {
            case ERR_NOT_IN_RANGE:
                state.isWalking = true;
                creep.moveTo(controller);
                if (this.tickDull()) return;
                this.transitDistribute();
                return;
            case ERR_NOT_ENOUGH_RESOURCES:
                this.transitCollect();
                return;
            default:
                state.isWalking = false;
        }
    }
}
