import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "./base";
import { getSpecializedCreep } from "./frame";
import { initializeCreepMemory, spawnCreep } from "./spawn";

interface CollectorCreepState {
    sourceId?: Id<Source>;
    spawnId?: Id<StructureSpawn>;
    dullTicks?: number;
    mode: "collect" | "distribute" | "distribute-spawn" | "distribute-controller";
    isWalking?: boolean;
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
            initializeCreepMemory<CollectorCreepState>(name, CollectorCreep.rustyType, { mode: "collect" });
        }
        return name;
    }
    public nextFrame(): void {
        const { state } = this;
        switch (state.mode) {
            case "collect":
                this.nextFrameCollect();
                break;
            case "distribute":
                this.nextFrameDistribute();
                break;
            case "distribute-spawn":
                this.nextFrameDistributeSpawn();
                break;
            case "distribute-controller":
                this.nextFrameDistributeController();
                break;
            default:
                this.switchMode("collect");
                break;
        }
    }
    private switchMode(mode: CollectorCreepState["mode"]): void {
        const { creep, state } = this;
        creep.say(mode);
        this.logger.info(`Switch mode: ${state.mode} -> ${mode}.`);
        state.mode = mode;
        this.assignSource();
        this.assignSpawn();
        state.dullTicks = undefined;
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
    private assignSource(sourceId?: Id<Source>): void {
        const { state } = this;
        state.sourceId = sourceId;
    }
    private assignSpawn(spawnId?: Id<StructureSpawn>): void {
        const { state } = this;
        state.spawnId = spawnId;
    }
    private findNextSource(): boolean {
        const { creep, state } = this;
        if (state.mode !== "collect") throw new Error("Invalid state.");
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, {
            costCallback: (roomName, cost) => {
                const room = Game.rooms[roomName];
                if (!room) {
                    this.logger.warning(`Unable to check room ${roomName}.`);
                    return;
                }
                const sources = room.find(FIND_SOURCES_ACTIVE);
                for (const s of sources) {
                    let c: number | undefined;
                    if (s.energy <= 2) c = 255;
                    else if (s.energy <= 20) c = 50;
                    else if (s.energy <= 50) c = 30;
                    else if (s.energy <= 100) c = 20;
                    else c = undefined;
                    if (c != null) cost.set(s.pos.x, s.pos.y, c);
                }
                // Evade hostile creeps.
                const hostile = room.find(FIND_HOSTILE_CREEPS);
                for (const h of hostile) {
                    const { x, y } = h.pos;
                    if (h.getActiveBodyparts(RANGED_ATTACK)) {
                        for (let xd = -3; xd <= 3; xd++)
                            for (let yd = -3; yd <= 3; yd++)
                                cost.set(x + xd, y + yd, 255);
                    } else if (h.getActiveBodyparts(ATTACK)) {
                        for (let xd = -1; xd <= 1; xd++)
                            for (let yd = -1; yd <= 1; yd++)
                                cost.set(x + xd, y + yd, 255);
                    }
                }
            }
        });
        if (source) {
            this.assignSource(source.id);
            return true;
        }
        return false;
    }
    private findNextSpawn(): boolean {
        const { creep, state } = this;
        if (state.mode !== "distribute"
            && state.mode !== "distribute-controller"
            && state.mode !== "distribute-spawn"
        ) throw new Error("Invalid state.");
        const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS, {
            costCallback: (roomName, cost) => {
                const room = Game.rooms[roomName];
                if (!room) {
                    this.logger.warning(`Unable to check room ${roomName}.`);
                    return;
                }
                const spawns = room.find(FIND_MY_SPAWNS);
                for (const s of spawns) {
                    if (!s.store.getFreeCapacity(RESOURCE_ENERGY))
                        cost.set(s.pos.x, s.pos.y, 255);
                }
            }
        });
        if (spawn) {
            if (state.mode !== "distribute-spawn") this.switchMode("distribute-spawn");
            this.assignSpawn(spawn.id);
            return true;
        }
        return false;
    }
    private checkEnergyConstraint(): boolean {
        const { creep, state } = this;
        switch (state.mode) {
            case "collect":
                if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    if (!this.tryTransferEnergy() && !this.tickDull())
                        this.switchMode("distribute");
                    return false;
                }
                return true;
            case "distribute":
            case "distribute-controller":
            case "distribute-spawn":
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                    this.switchMode("collect");
                    return false;
                }
                return true;
            default:
                throw new Error("Invalid state.");
        }
    }
    private tryTransferEnergy(): boolean {
        const { creep } = this;
        const myEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
        if (!myEnergy) return false;
        const targets = creep.pos.findInRange(FIND_MY_CREEPS, 1, { filter: c => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 });
        const target = _(targets)
            .map(c => getSpecializedCreep(c))
            .filter(c => !!c)
            .minBy(c => {
                // Only transfer energy to walking creeps.
                if (c instanceof CollectorCreep && c.state.isWalking)
                    return c.creep.store.getFreeCapacity(RESOURCE_ENERGY);
                return undefined;
            });
        if (target) {
            const result = creep.transfer(target.creep, RESOURCE_ENERGY);
            this.logger.info(`tryTransferEnergy: creep.transfer(${target.creep}) -> ${result}.`);
            return result === OK;
        }
        return false;
    }
    private nextFrameCollect(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        const source = state.sourceId && Game.getObjectById(state.sourceId);
        const harvestResult = source && creep.harvest(source);
        this.logger.trace(`nextFrameCollect: creep.harvest -> ${harvestResult}.`);
        state.isWalking = harvestResult === ERR_NOT_IN_RANGE;
        if (!source || harvestResult === ERR_NOT_IN_RANGE) {
            if (source) creep.moveTo(source);
            if (this.tickDull()) return;
            // Recheck nearest source.
            if (!this.findNextSource()) {
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    this.switchMode("distribute");
                    return;
                }
                this.assignSource();
                return;
            }
        } else if (harvestResult === ERR_NOT_ENOUGH_RESOURCES) {
            if (source.ticksToRegeneration > 10)
                this.findNextSource();
            else
                creep.say("Wait Regn");
        }
    }
    private nextFrameDistribute(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep } = this;
        if (creep.room.controller?.my) {
            const { controller } = creep.room;
            if (controller.ticksToDowngrade <= 500) {
                // Resetting downgrade timer is priority.
                this.switchMode("distribute-controller");
                return;
            }
        }
        // Check whether there are spawns to transfer energy. Possibility: 1/2.
        if (_.random(2) > 0 && this.findNextSpawn()) return;
        // Otherwise, go upgrade controller.
        this.switchMode("distribute-controller");
    }
    private nextFrameDistributeSpawn(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        const spawn = state.spawnId && Game.getObjectById(state.spawnId);
        const transferResult = spawn && creep.transfer(spawn, RESOURCE_ENERGY);
        state.isWalking = transferResult === ERR_NOT_IN_RANGE;
        this.logger.trace(`nextFrameDistributeSpawn: creep.transfer(${spawn}) -> ${transferResult}.`);
        if (!spawn || transferResult === ERR_NOT_IN_RANGE) {
            if (spawn) creep.moveTo(spawn);
            if (this.tickDull()) return;
            // Recheck nearest spawn.
            if (!this.findNextSpawn()) {
                // We have more energy.
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= creep.store.getCapacity(RESOURCE_ENERGY) / 5)
                    this.switchMode("distribute");
                else
                    this.switchMode("collect");
                return;
            }
        } else if (transferResult === ERR_FULL) {
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= creep.store.getCapacity(RESOURCE_ENERGY) / 4) {
                if (this.tickDull()) return;
                this.switchMode("distribute");
            }
            else {
                this.switchMode("collect");
            }
        }
    }
    private nextFrameDistributeController(): void {
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        let { controller } = creep.room;
        if (!controller?.my) {
            // We have more energy.
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= creep.store.getCapacity(RESOURCE_ENERGY) / 4) {
                if (this.tickDull()) return;
                this.switchMode("distribute-spawn");
            } else {
                this.switchMode("collect");
            }
            return;
        }
        const result = creep.upgradeController(controller);
        this.logger.trace(`nextFrameDistributeController: creep.upgradeController(${controller}) -> ${result}.`);
        switch (result) {
            case ERR_NOT_IN_RANGE:
                state.isWalking = true;
                creep.moveTo(controller);
                return;
            case ERR_NOT_ENOUGH_RESOURCES:
                this.switchMode("distribute");
                return;
            default:
                state.isWalking = false;
        }
    }
}
