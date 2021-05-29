import _ from "lodash/index";
import { evadeHostileCreeps, findNearestPath } from "src/utility/pathFinder";
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
    readonly sourceId: Id<Source>;
}

interface CollectorCreepStateCollectTombstone extends CollectorCreepStateCollect {
    readonly tombstoneId: Id<Tombstone>;
}

interface CollectorCreepStateCollectResource extends CollectorCreepStateCollect {
    readonly resourceId: Id<Resource>;
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
    | CollectorCreepStateCollectResource
    | CollectorCreepStateDistributeSpawn
    | CollectorCreepStateDistributeController;

let occupiedDests: Map<Id<Tombstone> | Id<Resource>, Id<Creep>> | undefined;

function getExclusiveCollector(id: Id<Tombstone> | Id<Resource>): Id<Creep> | undefined {
    if (!occupiedDests) {
        occupiedDests = new Map();
        for (const c of enumSpecializedCreeps(CollectorCreep)) {
            if (c.state.mode === "collect") {
                if ("tombstoneId" in c.state) occupiedDests.set(c.state.tombstoneId, c.id);
                else if ("resourceId" in c.state) occupiedDests.set(c.state.resourceId, c.id);
            }
        }
    }
    return occupiedDests.get(id);
}

function declareExclusiveDestCollector(id: Id<Tombstone> | Id<Resource>, collector?: Id<Creep>): void {
    if (!occupiedDests) return;
    if (collector)
        occupiedDests.set(id, collector);
    else
        occupiedDests.delete(id);
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
            creep.say(newState.mode.split("-").map(s => s.substr(0, 4)).join("-"));
            this.logger.info(`Switch mode: ${state.mode} -> ${newState.mode}.`);
        }
        if (state.mode === "collect") {
            if ("tombstoneId" in state) declareExclusiveDestCollector(state.tombstoneId);
            if ("resourceId" in state) declareExclusiveDestCollector(state.resourceId);
        }
        if (newState.mode === "collect") {
            if ("tombstoneId" in state) declareExclusiveDestCollector(state.tombstoneId, this.id);
            if ("resourceId" in state) declareExclusiveDestCollector(state.resourceId, this.id);
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
        const { creep } = this;
        const { room } = creep;
        const resources = room.find(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY
                && (getExclusiveCollector(r.id) || this) === this
                && r.amount * (1 - r.pos.getRangeTo(creep) * 1.6 / ENERGY_DECAY) > 20
        }) as Resource<RESOURCE_ENERGY>[];
        const tombstones = room.find(FIND_TOMBSTONES, {
            filter: t => t.store.energy >= 20 && t.ticksToDecay >= 3
                && (getExclusiveCollector(t.id) || this) === this
        });
        const sources = room.find(FIND_SOURCES_ACTIVE, {
            filter: t => t.energy >= 50 || t.energyCapacity >= 100 && t.ticksToRegeneration <= 20
        });
        const goals = [...resources, ...tombstones, ...sources];
        const nearest = findNearestPath(creep.pos, goals, {
            maxRooms: 1, roomCallback: roomName => {
                const room = Game.rooms[roomName];
                if (!room) {
                    this.logger.warning(`Unable to check room ${roomName}.`);
                    return false;
                }
                const costs = new PathFinder.CostMatrix();
                evadeHostileCreeps(room, costs);
                return costs;
            }
        });
        if (!nearest) return false;
        this.logger.info(`Collect ${nearest.goal}.`);
        if (nearest.goal instanceof Resource)
            this.state = { mode: "collect", resourceId: nearest.goal.id, destId: nearest.goal.id };
        else if (nearest.goal instanceof Tombstone)
            this.state = { mode: "collect", tombstoneId: nearest.goal.id, destId: nearest.goal.id };
        else if (nearest.goal instanceof Source)
            this.state = { mode: "collect", sourceId: nearest.goal.id, destId: nearest.goal.id };
        else
            throw new Error("Unexpected code path.");
        return true;
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
        if ("resourceId" in state) {
            const resource = dest = Game.getObjectById(state.resourceId);
            result = resource ? creep.pickup(resource) : undefined;
            this.logger.trace(`nextFrameCollect: creep.withdraw -> ${result}.`);
        } else if ("tombstoneId" in state) {
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
