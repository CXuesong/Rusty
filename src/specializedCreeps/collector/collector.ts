import _ from "lodash";
import { priceSheet } from "src/market/localPriceSheet";
import { bodyPartArrayToProfile, BodyPartProfile } from "src/utility/creep";
import { Logger } from "src/utility/logger";
import { findNearestPath, findPathTo } from "src/utility/pathFinder";
import { enumSpecializedCreeps, SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "../base";
import { getSpecializedCreep } from "../registry";
import { initializeCreepMemory, spawnCreep } from "../spawn";
import { getRoomMemory } from "./memory";
import { canStorageAcceptEnergy, isCollectableFrom, structureNeedsRepair } from "./predicates";
import { CollectorCreepCollectPrimaryTargetType, CollectorCreepCollectTargetType, CollectorCreepDistributeStructureType, CollectorCreepDistributeTargetType, CollectorCreepOperation, CollectorCreepState } from "./state";
import { addTargetingCollector, getTargetingCollectors, initialize as initializeTargetTracking, removeTargetingCollector } from "./targetTracking";

export const MIN_COLLECTABLE_ENERGY = 20;
// const MAX_SOURCE_REGENERATION_WAIT = 20;
const RANGE_DISTANCE_RATIO = 1.6;

export const collectorCreepVariants = ["normal", "tall", "grande", "venti", "trenta"] as const;
export type CollectorCreepVariant = (typeof collectorCreepVariants)[number];

const variantDefinitions: Record<CollectorCreepVariant, { body: BodyPartProfile, prefix: string }> = {
    normal: {
        prefix: "CN:",
        // 300
        body: {
            [CARRY]: 2,     // 50
            [MOVE]: 2,      // 50
            [WORK]: 1,      // 100
        }
    },
    tall: {
        // 500
        prefix: "CT:",
        body: {
            [CARRY]: 2,
            [MOVE]: 4,
            [WORK]: 2,
        }
    },
    grande: {
        // 800
        prefix: "CG:",
        body: {
            [CARRY]: 2,
            [MOVE]: 6,
            [WORK]: 4,
        }
    },
    venti: {
        // 1200
        prefix: "CV:",
        body: {
            [CARRY]: 4,
            [MOVE]: 8,
            [WORK]: 6,
        }
    },
    trenta: {
        // 1900
        prefix: "CTr:",
        body: {
            [CARRY]: 6,
            [MOVE]: 12,
            [WORK]: 10,
        }
    }
};

export class CollectorCreep extends SpecializedCreepBase<CollectorCreepState> {
    public static readonly rustyType = "collector";
    private logger = new Logger(`Rusty.SpecializedCreeps.CollectorCreep.#${this.creep.name}`);
    public static spawn(spawn: StructureSpawn, variant?: CollectorCreepVariant): string | SpecializedSpawnCreepErrorCode {
        if (!variant) variant = "normal";
        var def = variantDefinitions[variant];
        const name = spawnCreep(spawn, def.body, { namePrefix: def.prefix });
        if (typeof name === "string") {
            initializeCreepMemory<CollectorCreepState>(name,
                CollectorCreep.rustyType,
                {
                    operation: { startTime: Game.time, opName: "idle", nextEvalTime: Game.time },
                    recentOperations: []
                });
        }
        return name;
    }
    protected onNextFrame(): void {
        const { state } = this;
        switch (state.operation?.opName) {
            case "idle":
                this.nextFrameIdle();
                break;
            case "collect":
                this.nextFrameCollect();
                break;
            case "distribute":
                this.nextFrameDistribute();
                break;
            default:
                this.transitIdle();
                break;
        }
        this.renderTargetVisual();
    }
    public dispose() {
        if (this.disposed) return;
        const { state } = this;
        const { operation } = state;
        if ("targetId" in operation) {
            removeTargetingCollector(operation.targetId, this.id);
        }
        super.dispose();
    }
    private _variant: CollectorCreepVariant | undefined;
    public get variant() {
        if (!this._variant) {
            const { creep } = this;
            const body = bodyPartArrayToProfile(creep.body);
            if (body.move === 4) this._variant = "tall";
            else if (body.move === 6) this._variant = "grande";
            else if (body.move === 8) this._variant = "venti";
            else if (body.move === 12) this._variant = "trenta";
            else this._variant = "normal";
        }
        return this._variant;
    }
    private renderTargetVisual() {
        const { creep, state } = this;
        const { room } = creep;
        const { operation } = state;
        if ("targetId" in operation) {
            const target = Game.getObjectById(operation.targetId as Id<RoomObject>);
            if (target) {
                room.visual.line(creep.pos, target.pos, {
                    color: operation.opName === "collect" ? "#ff0000" : "#00ff00",
                    lineStyle: "dashed",
                    opacity: 0.6,
                });
            } else {
                room.visual.text("Target Lost", creep.pos);
            }
        }
    }
    private setStateOperation(operation: CollectorCreepOperation) {
        const { creep, state } = this;
        if (operation.opName !== state.operation.opName) {
            creep.say(operation.opName);
            this.logger.info(`Switch mode: ${state.operation.opName} -> ${operation.opName}.`);
        }
        if ("targetId" in state.operation && (!("targetId" in operation) || operation.targetId !== state.operation.targetId)) {
            removeTargetingCollector(state.operation.targetId, this.id);
        }
        if ("targetId" in operation)
            addTargetingCollector(operation.targetId, this.id);
        state.recentOperations.push({ ...state.operation, endTime: Game.time });
        while (state.recentOperations.length && state.recentOperations[0].endTime + 20 < Game.time)
            state.recentOperations.shift();
        state.operation = { startTime: Game.time, ...operation };
    }
    private recentlyCollectedFrom(targetId: Id<RoomObject>): boolean {
        const { state } = this;
        return state.operation.opName === "collect" && state.operation.targetId === targetId
            || !!state.recentOperations.find(o => o.opName === "collect" && o.targetId === targetId)
    }
    private recentlyDistributedTo(targetId: Id<RoomObject>): boolean {
        const { state } = this;
        return state.operation.opName === "distribute" && state.operation.targetId === targetId
            || !!state.recentOperations.find(o => o.opName === "distribute" && o.targetId === targetId)
    }
    private transitCollect(): boolean {
        const { creep, state } = this;
        const { room } = creep;
        const { operation } = state;
        if (!creep.store.getFreeCapacity()) return false;
        if (operation.opName === "collect") {
            // Keep incremental state update if current is already in collect state.
            const target = Game.getObjectById(operation.targetId);
            if (target) {
                if (target instanceof Creep) {
                } else if (isCollectableFrom(target, creep.pos) && this.assignPath(target)) {
                    return true;
                }
            }
        }
        const untargeted = _(getRoomMemory(room).untargetedCollectables)
            .entries().filter(([id, since]) => Game.time >= since + 10 && !getTargetingCollectors(id as Id<any>).size)
            .map(([id]) => Game.getObjectById(id as Id<CollectorCreepCollectPrimaryTargetType>)!)
            .filter(s => !!s && isCollectableFrom(s, creep.pos))
            .value();
        const targets: CollectorCreepCollectTargetType[] = untargeted.length
            ? untargeted
            : [
                ...room.find(FIND_TOMBSTONES),
                ...room.find(FIND_RUINS),
                ...room.find(FIND_DROPPED_RESOURCES),
                ...room.find(FIND_SOURCES),
            ].filter(t => isCollectableFrom(t, creep.pos));
        // Prefer collect from direct source.
        let nearest = findNearestPath(creep.pos, targets, { maxRooms: 1 });
        this.logger.info(`transitCollect: Nearest target: ${nearest?.goal}, cost ${nearest?.cost}.`);
        if (!nearest || nearest.cost > 10) {
            // If every direct source is too far away...
            // We allow stealing energy from existing collecting creeps,
            // only if they have already collected some energy.
            const collectingCreeps = enumSpecializedCreeps(CollectorCreep, room)
                .filter(c => c !== this
                    && c.state.operation.opName === "collect"
                    && !c.state.isWalking
                    && (("sourceId" in c.state.operation || "sourceCreepId" in c.state.operation) && c.state.operation.sourceDistance <= 1))
                .filter(c => {
                    const collectors = getTargetingCollectors(c.id)
                    return collectors.size == 0 || collectors.size == 1 && collectors.has(creep.id)
                })
                .map(c => c.creep)
                .filter(c => {
                    // We still need some time to arrive the target creep. Target can collect some more energy meanwhile.
                    const energyCap = c.store.getCapacity();
                    const energyEst = Math.max(energyCap, c.store.energy + creep.pos.getRangeTo(c) * RANGE_DISTANCE_RATIO * c.getActiveBodyparts(WORK));
                    return energyEst / energyCap >= 0.6 || energyEst / creep.store.getCapacity() >= 0.8
                })
                .value();
            // Also take a look at the storage at this point, before wandering away.
            const storage = room.storage && room.storage.store.energy > creep.store.getFreeCapacity() * 0.8
                ? [room.storage] : [];
            const links = _(room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }) as StructureLink[])
                .filter(l => l.store.energy >= creep.store.getFreeCapacity() * 0.5);
            const targets = [
                ...storage,
                ...links,
                ...collectingCreeps
            ].filter(t => !this.recentlyDistributedTo(t.id));
            const secondary = targets.length
                ? findNearestPath(creep.pos, targets, { maxRooms: 1 })
                : undefined;
            this.logger.info(`transitCollect: Secondary target: ${secondary?.goal}, cost ${secondary?.cost}.`);
            if (!nearest || secondary && nearest.cost - secondary.cost > 10)
                nearest = secondary;
        }
        if (!nearest) return false;
        const targetId = nearest.goal.id;
        const nextEvalTime = Game.time + _.random(4, 10);
        const distance = nearest.goal.pos.getRangeTo(creep);
        this.logger.info(`transitCollect: Collect ${nearest.goal}, path: [${nearest.path.length}], cost ${nearest?.cost}, distnace: ${distance}.`);
        if (!nearest.path.length && distance > 1) {
            this.logger.warning(`transitCollect: Empty path to ${nearest.goal}. Distance: ${distance}.`);
        }
        if (nearest.goal instanceof Resource)
            this.setStateOperation({ opName: "collect", resourceId: nearest.goal.id, targetId, nextEvalTime });
        else if (
            nearest.goal instanceof Tombstone
            || nearest.goal instanceof StructureStorage
            || nearest.goal instanceof Ruin
            || nearest.goal instanceof StructureLink)
            this.setStateOperation({ opName: "collect", storageId: nearest.goal.id, targetId, sourceDistance: 0, nextEvalTime });
        else if (nearest.goal instanceof Source)
            this.setStateOperation({ opName: "collect", sourceId: nearest.goal.id, targetId, sourceDistance: 0, nextEvalTime });
        else if (nearest.goal instanceof Creep) {
            const sourceCollector = getSpecializedCreep(nearest.goal, CollectorCreep);
            if (!sourceCollector) throw new Error("Unexpected null sourceCollector.");
            const sourceOperation = sourceCollector.state.operation;
            if (sourceOperation.opName === "collect" && ("sourceId" in sourceOperation || "sourceCreepId" in sourceOperation)) {
                this.setStateOperation({
                    opName: "collect",
                    sourceCreepId: nearest.goal.id,
                    targetId,
                    sourceDistance: sourceOperation.sourceDistance + 1,
                    nextEvalTime
                });
            } else {
                throw new Error("Unexpected sourceCollector state.");
            }
        } else
            throw new Error("Unexpected code path.");
        this.assignPath(nearest.goal, nearest.path);
        return true;
    }
    private transitIdle(nextEvalTimeOffset?: number): boolean {
        this.setStateOperation({ opName: "idle", nextEvalTime: nextEvalTimeOffset ?? (Game.time + _.random(5)) });
        return true;
    }
    private pathCache: { targetId: string; targetPath: RoomPosition[] } | undefined;
    private assignPath(target: RoomObject & { id: string }, path?: RoomPosition[]): boolean {
        if (!path) {
            const { creep } = this;
            const result = findPathTo(creep, target.pos, { maxRooms: 1 });
            if (!result) return false;
            path = result.path;
        }
        this.pathCache = {
            targetId: target.id,
            targetPath: path,
        };
        return true;
    }
    private transitDistribute(): boolean {
        const { creep, state } = this;
        const creepEnergyAmount = creep.store.energy;
        const creepOtherAmount = _(creep.store).values().sum() - creepEnergyAmount;
        const creepHasEnergy = creepEnergyAmount >= 1;
        // Empty creep.
        if (creepEnergyAmount + creepOtherAmount < 1) return false;
        const { room } = creep;
        const canTransferEnergyToStructure = (s: CollectorCreepDistributeStructureType): boolean => {
            if (!("store" in s)) return false;
            const freeCap = s.store.getFreeCapacity(RESOURCE_ENERGY);
            const minFreeCap = s instanceof StructureSpawn ? 10 : 0;
            if (freeCap < minFreeCap) return false;
            const targetingCollectors = getTargetingCollectors(s.id);
            // Traffic control.
            if (targetingCollectors.size >= 6) return false;
            const incomingEnergy = _([...targetingCollectors]).map(id => Game.getObjectById(id)?.store.energy || 0).sum();
            return incomingEnergy < freeCap;
        }
        if (state.operation.opName === "distribute") {
            const { operation } = state;
            // Keep incremental state update if current is already in distribute state.
            if (creepHasEnergy && "controllerId" in operation) {
                const c = Game.getObjectById(operation.controllerId);
                if (c?.my && this.assignPath(c))
                    return true;
            } else if (creepHasEnergy && "constructionSiteId" in operation) {
                const s = Game.getObjectById(operation.constructionSiteId);
                if (s && s.progress < s.progressTotal && this.assignPath(s))
                    return true;
            } else if ("structureId" in operation) {
                const st = Game.getObjectById(operation.structureId);
                if (st) {
                    const minFreeCap = st instanceof StructureSpawn ? 10 : 0;
                    if (st instanceof StructureStorage) {
                        if (this.assignPath(st)) return true;
                    } else if (creepHasEnergy && (structureNeedsRepair(st) || "store" in st && st.store.getFreeCapacity(RESOURCE_ENERGY) > minFreeCap)) {
                        if (this.assignPath(st)) return true;
                    }
                }
            }
        }
        const nextEvalTime = Game.time + _.random(4, 10);
        if (!creepHasEnergy) {
            // If creep does not own any energy, for now it has no way but go back to the storage.
            const { storage } = room;
            if (storage?.my && this.assignPath(storage)) {
                const targetId = storage.id;
                this.setStateOperation({ opName: "distribute", structureId: targetId, targetId, nextEvalTime });
                return true;
            }
            return false;
        }
        let structures = _(room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_EXTENSION && s.my
                || s.structureType === STRUCTURE_TOWER && s.my
                || s.structureType === STRUCTURE_RAMPART && s.my
                || s.structureType === STRUCTURE_SPAWN && s.my
                || s.structureType === STRUCTURE_ROAD
                || s.structureType === STRUCTURE_WALL
                || s.structureType === STRUCTURE_CONTAINER && s.isActive
                || s.structureType === STRUCTURE_STORAGE && s.my && s.isActive && (creepHasEnergy && canStorageAcceptEnergy(s) || creepOtherAmount > 0 && s.store.getFreeCapacity() > 0)
                || s.structureType === STRUCTURE_LINK && s.my
        }))
            // Prevent transferring energy in & out from storage repetitively.
            .filter(s => !this.recentlyCollectedFrom(s.id))
            .map(s => ({
                structure: s as CollectorCreepDistributeStructureType,
                needsRepair: structureNeedsRepair(s),
                storeVacancy: "store" in s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            }))
            .filter(e => !!e.needsRepair || e.storeVacancy)
            .value();
        const towers = structures.filter((s) => s.structure instanceof StructureTower);
        let controllerPriority = 0;
        const { controller } = room;
        if (controller?.my) {
            const targetingWorkParts = _([...getTargetingCollectors(controller.id)])
                .map(id => Game.getObjectById(id)?.getActiveBodyparts(WORK) || 0)
                .sum();
            if (targetingWorkParts < 2 || controller.ticksToDowngrade <= 7200 && targetingWorkParts < 8) {
                // Resetting downgrade timer is priority.
                controllerPriority = 1;
            } else if (targetingWorkParts < 16) {
                controllerPriority = 0.5;
            } else if (targetingWorkParts < 24) {
                controllerPriority = 0.1;
            }
        }
        if (controllerPriority === 0 || controllerPriority < 1 && _.random(true) > controllerPriority) {
            let goals;
            if (towers.length && _(towers).map(t => creep.pos.getRangeTo(t.structure)).min()! < 20) {
                // Feeding tower is top priority.
                goals = towers.map(e => e.structure) as CollectorCreepDistributeStructureType[];
            } else {
                // We consider structures in urgent need of fixing first.
                const priorityStructures = structures.filter(s => (
                    s.structure instanceof StructureSpawn
                    || s.structure instanceof StructureExtension
                ) && canTransferEnergyToStructure(s.structure)).map(s => s.structure);
                const fixableStructures = structures
                    .filter(e => e.needsRepair === "now" && getTargetingCollectors(e.structure.id).size < 6)
                    .map(e => e.structure);
                const constructionSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.progress < s.progressTotal });
                goals = [
                    ...priorityStructures,
                    ...fixableStructures,
                    ...constructionSites,
                ];
            }
            let nearest = findNearestPath<CollectorCreepDistributeTargetType>(creep.pos, goals, { maxRooms: 1 });
            if (!nearest) {
                // No goal.
                this.logger.info(`transitDistribute: No primary goal.`);
                const storageStructureTypes: StructureConstant[] = [STRUCTURE_STORAGE, STRUCTURE_CONTAINER, STRUCTURE_LINK];
                // Try some no-so-urgent stuff
                let targetGroups: [label: string, possibility: number, structures: { structure: CollectorCreepDistributeStructureType }[]][] = [
                    ["energy sink", 3, structures.filter(e =>
                        !storageStructureTypes.includes(e.structure.structureType)
                        && canTransferEnergyToStructure(e.structure))],
                    ["fixable structure", 4, structures.filter(e => e.needsRepair === "yes")],
                    ["low-pri fixable structure", 2, _(structures).filter(e => e.needsRepair === "later").sampleSize(10).value()],
                    ["low-pri fixable structure (forced)", 1, _(structures).filter(e => e.needsRepair === "later").sampleSize(1).value()],
                    ["energy storage", 2, structures.filter(e => storageStructureTypes.includes(e.structure.structureType))],
                ];
                targetGroups = targetGroups.filter(([, , sts]) => sts.length);
                while (targetGroups.length) {
                    const possibilityCumSum = [0];
                    for (const [, pos] of targetGroups) {
                        possibilityCumSum.push(_(possibilityCumSum).last()! + pos);
                    }
                    const pos = _.random(true) * _(possibilityCumSum).last()!;
                    const groupIndex = _.range(0, targetGroups.length).find(i => possibilityCumSum[i] <= pos && possibilityCumSum[i + 1] > pos);
                    const group = targetGroups[groupIndex ?? 0];
                    const [name, , sts] = group;
                    // this.logger.warning(`${pos}/${_(possibilityCumSum).last()!} --> ${targetGroups.map(g => `${g[0]}: ${g[1]}`)} --> ${group[0]}`);
                    nearest = findNearestPath(creep.pos, sts.map(s => s.structure), { maxRooms: 1 });
                    if (nearest) {
                        this.logger.info(`transitDistribute: Found secondary goal (${name}).`);
                        break;
                    } else {
                        targetGroups.remove(group);
                    }
                }
            }
            if (nearest) {
                const targetId = nearest.goal.id as Id<any>;
                this.logger.info(`Distribute ${nearest.goal}.`);
                if (nearest.goal instanceof ConstructionSite)
                    this.setStateOperation({ opName: "distribute", constructionSiteId: nearest.goal.id, targetId, nextEvalTime });
                else
                    this.setStateOperation({ opName: "distribute", structureId: nearest.goal.id as Id<any>, targetId, nextEvalTime });
                this.assignPath(nearest.goal, nearest.path);
                return true;
            }
        }
        if (creepHasEnergy && controller?.my) {
            this.setStateOperation({ opName: "distribute", controllerId: controller.id, targetId: controller.id, nextEvalTime });
            if (!this.assignPath(controller)) {
                this.logger.warning(`Failed to arrange a path to the controller: ${controller}.`);
                return false;
            }
            return true;
        }
        return false;
    }
    private checkStoreConstraint(): boolean {
        const { creep, state } = this;
        switch (state.operation.opName) {
            case "idle":
                return true;
            case "collect":
                if (!creep.store.getFreeCapacity()) {
                    this.logger.trace("Reached max store cap. transitDistribute.");
                    this.transitDistribute() || this.transitIdle();
                    return false;
                }
                return true;
            case "distribute":
                if (!creep.store.getUsedCapacity()) {
                    this.transitCollect() || this.transitIdle();
                    return false;
                }
                return true;
            default:
                throw new Error("Invalid state.");
        }
    }
    private nextFrameIdle(): void {
        const { creep, state } = this;
        if (state.operation.opName !== "idle") throw new Error("Invalid state.");
        if (Game.time < state.operation.nextEvalTime) {
            creep.say(`Idle${state.operation.nextEvalTime - Game.time}`);
            return;
        }
        const usedCap = creep.store.getUsedCapacity();
        const energy = creep.store.energy;
        const totalCap = creep.store.getCapacity();
        if (usedCap / totalCap < 0.2 && this.transitCollect())
            return;
        if ((usedCap / totalCap > 0.15 || usedCap - energy > 0) && this.transitDistribute())
            return;
        this.transitIdle();
        creep.say("IdleStil");
    }
    private nextFrameCollect(): void {
        if (!this.checkStoreConstraint()) return;
        const { creep, state } = this;
        if (state.operation.opName !== "collect") throw new Error("Invalid state.");
        const { operation } = state;
        let result;
        let target;
        if ("resourceId" in operation) {
            const resource = target = Game.getObjectById(operation.resourceId);
            result = resource ? creep.pickup(resource) : undefined;
            this.logger.trace(`nextFrameCollect: creep.pickup -> ${result}.`);
        } else if ("storageId" in operation) {
            const storage = target = Game.getObjectById(operation.storageId);
            if (storage) {
                // Take the most valuable one first. Take energy last.
                // Do not pick up anything other than energy from Storage.
                const energyKey = storage instanceof StructureStorage
                    ? RESOURCE_ENERGY
                    : _(storage.store)
                        .entries()
                        .filter(([, v]) => v > 0)
                        .map(([k]) => k as ResourceConstant)
                        .maxBy(k => k === RESOURCE_ENERGY ? -2 : priceSheet[k] ?? -1);
                if (energyKey) {
                    result = creep.withdraw(storage, energyKey);
                } else {
                    result = ERR_NOT_ENOUGH_RESOURCES;
                }
                this.logger.trace(`nextFrameCollect: creep.withdraw(${energyKey}) -> ${result}.`);
            }
        } else if ("sourceCreepId" in operation) {
            const sc = target = Game.getObjectById(operation.sourceCreepId);
            const scollector = sc && getSpecializedCreep(sc, CollectorCreep);
            const scoperation = scollector?.state.operation;
            if (scoperation?.opName == "collect" && "sourceDistance" in scoperation && scoperation.sourceDistance < operation.sourceDistance) {
                if (!sc) {
                    result = undefined;
                } else if (sc.store.energy >= 5) {
                    result = sc ? sc.transfer(creep, RESOURCE_ENERGY) : undefined;
                    this.logger.trace(`nextFrameCollect: ${sc}.transfer(creep) -> ${result}.`);
                } else {
                    this.logger.info(`nextFrameCollect: sourceCreep ${sc} energy is exhausted.`);
                    if (!this.transitCollect())
                        this.transitIdle();
                    return
                }
            } else {
                // In case peer changed source.
                result = undefined;
                this.logger.info(`nextFrameCollect: sourceCreep ${sc} changed source: mode=${scoperation?.opName}.`);
            }
        } else {
            const source = target = Game.getObjectById(operation.sourceId);
            if (source) {
                result = creep.harvest(source);
                this.logger.trace(`nextFrameCollect: creep.harvest -> ${result}.`);
            } else {
                result = undefined;
            }
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE || result === ERR_NOT_ENOUGH_RESOURCES) {
            if (
                // target is gone.
                !target
                // Need to prepare next path.
                || Game.time >= operation.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
                // Transient cache lost.
                || this.pathCache?.targetId !== target.id) {
                if (!this.transitCollect()) {
                    this.transitIdle();
                    return;
                }
            }
            if (!creep.fatigue) {
                if (!this.pathCache) throw new Error("Assertion failure.");
                if (this.pathCache.targetPath.length) {
                    const moveResult = creep.moveByPath(this.pathCache.targetPath);
                    if (moveResult !== OK) {
                        this.logger.warning(`nextFrameCollect: creep.moveByPath(${target}) -> ${moveResult}.`);
                        if (moveResult === ERR_NOT_FOUND) {
                            this.logger.trace(`pathCache: ${JSON.stringify(this.pathCache)}.`);
                            this.transitCollect();
                        }
                    }
                } else if (target && target.id === this.pathCache.targetId && this.creep.pos.inRangeTo(target, 1)) {
                    creep.say("Wait Regn");
                } else {
                    this.logger.warning(`Unexpected empty targetPath in pathCache. Target: ${target}.`);
                }
            }
            return;
        }
    }
    private nextFrameDistribute(): void {
        if (!this.checkStoreConstraint()) return;
        const { creep, state } = this;
        if (state.operation.opName !== "distribute") throw new Error("Invalid state.");
        const { operation } = state;
        const hasEnergy = creep.store.energy > 0;
        let result;
        let target;
        if ("constructionSiteId" in operation) {
            const constructionSite = target = Game.getObjectById(operation.constructionSiteId);
            result = constructionSite ? creep.build(constructionSite) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.build -> ${result}.`);
        } else if ("structureId" in operation) {
            const st = target = Game.getObjectById(operation.structureId);
            if (st) {
                const needsRepair = structureNeedsRepair(st);
                const freeCap = "store" in st ? st.store.getFreeCapacity(RESOURCE_ENERGY) : 0;
                if (hasEnergy && (needsRepair === "now" || needsRepair && !freeCap)) {
                    // Fix construct, if it needs fixing or we have more energy.
                    result = creep.repair(st);
                    this.logger.trace(`nextFrameDistribute: creep.repair(${st}) -> ${result}.`);
                } else if (st instanceof StructureStorage && st.my) {
                    // transfer one kind of resource at a time.
                    const resourceType = _(creep.store).entries().filter(([, v]) => v > 0).map(([k]) => k as ResourceConstant).first();
                    result = resourceType ? creep.transfer(st, resourceType) : ERR_NOT_ENOUGH_RESOURCES;
                    this.logger.trace(`nextFrameDistribute: creep.transfer -> ${result}.`);
                } else {
                    result = creep.transfer(st, RESOURCE_ENERGY);
                    this.logger.trace(`nextFrameDistribute: creep.transfer -> ${result}.`);
                }
            } else {
                result = undefined;
            }
        } else {
            const controller = target = Game.getObjectById(operation.controllerId);
            result = controller ? creep.upgradeController(controller) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.upgradeController -> ${result}.`);
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE || result == ERR_INVALID_TARGET) {
            if (
                // target is gone.
                !target
                // Need to prepare next path.
                || Game.time >= operation.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
                // Transient cache lost.
                || this.pathCache?.targetId !== target.id) {
            } {
                // Recheck nearest spawn / controller.
                if (!this.transitDistribute()) {
                    this.transitIdle();
                    return;
                }
            }
            if (!creep.fatigue) {
                if (!this.pathCache) throw new Error("Assertion failure.");
                if (this.pathCache.targetPath.length) {
                    const moveResult = creep.moveByPath(this.pathCache.targetPath);
                    if (moveResult !== OK) {
                        this.logger.warning(`nextFrameDistribute: creep.moveByPath(${target}) -> ${moveResult}.`);
                        creep.room.visual.rect(creep.pos.x, creep.pos.y, 1, 1, { fill: "#ff0000" });
                    }
                }
            }
            return;
        } if (result === ERR_NOT_ENOUGH_RESOURCES) {
            if (!this.transitCollect())
                this.transitIdle();
            return;
        }
        if (result === ERR_FULL) {
            if (creep.store.getUsedCapacity() > 0 && this.transitDistribute()) return;
            this.transitIdle();
            return;
        }
    }
}

initializeTargetTracking(CollectorCreep);
