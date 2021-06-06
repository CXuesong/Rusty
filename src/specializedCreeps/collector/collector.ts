import _ from "lodash";
import { bodyPartArrayToProfile, BodyPartProfile } from "src/utility/creep";
import { Logger } from "src/utility/logger";
import { findNearestPath, findPathTo } from "src/utility/pathFinder";
import { enumSpecializedCreeps, SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "../base";
import { getSpecializedCreep } from "../registry";
import { initializeCreepMemory, spawnCreep } from "../spawn";
import { getRoomMemory } from "./memory";
import { isCollectableFrom, structureNeedsRepair } from "./predicates";
import { CollectorCreepCollectPrimaryTargetType, CollectorCreepCollectTargetType, CollectorCreepDistributeStructureType, CollectorCreepDistributeTargetType, CollectorCreepState } from "./state";
import { addTargetingCollector, getTargetingCollectors, initialize as initializeTargetTracking, removeTargetingCollector } from "./targetTracking";

export const MIN_COLLECTABLE_ENERGY = 20;
// const MAX_SOURCE_REGENERATION_WAIT = 20;
const RANGE_DISTANCE_RATIO = 1.6;

export type CollectorCreepVariant = "normal" | "tall" | "grande" | "venti";

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
            initializeCreepMemory<CollectorCreepState>(name, CollectorCreep.rustyType, { mode: "idle", nextEvalTime: Game.time });
        }
        return name;
    }
    protected onNextFrame(): void {
        const { state } = this;
        switch (state.mode) {
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
    protected onStateRootChanging(newState: CollectorCreepState): CollectorCreepState {
        const { creep, state } = this;
        if (newState.mode !== state.mode) {
            creep.say(newState.mode.split("-").map(s => s.substr(0, 4)).join("-"));
            this.logger.info(`Switch mode: ${state.mode} -> ${newState.mode}.`);
        }
        if ((state.mode === "collect" || state.mode === "distribute")
            && (newState.mode !== state.mode || !("targetId" in newState) || newState.targetId !== state.targetId)) {
            removeTargetingCollector(state.targetId, this.id);
            if (newState.mode === "collect" || newState.mode === "distribute")
                addTargetingCollector(newState.targetId, this.id);
        }
        return newState;
    }
    public dispose() {
        const { state } = this;
        if (this.disposed) return;
        if ((state.mode === "collect" || state.mode === "distribute") && "targetId" in state) {
            removeTargetingCollector(state.targetId, this.id);
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
            else this._variant = "normal";
        }
        return this._variant;
    }
    private renderTargetVisual() {
        const { creep, state } = this;
        const { room } = creep;
        if ("targetId" in state) {
            const target = Game.getObjectById(state.targetId as Id<RoomObject>);
            if (target) {
                room.visual.line(creep.pos, target.pos, {
                    color: state.mode === "collect" ? "#ff0000" : "#00ff00",
                    lineStyle: "dashed",
                    opacity: 0.6,
                });
            } else {
                room.visual.text("Target Lost", creep.pos);
            }
        }
    }
    private transitCollect(): boolean {
        const { creep } = this;
        const { room } = creep;
        const untargeted = _(getRoomMemory(room).untargetedCollectables)
            .entries().filter(([id, since]) => Game.time >= since + 10 && !getTargetingCollectors(id as Id<any>).size)
            .map(([id]) => Game.getObjectById(id as Id<CollectorCreepCollectPrimaryTargetType>)!)
            .filter(s => !!s && isCollectableFrom(s, creep.pos))
            .value();
        const targets: CollectorCreepCollectTargetType[] = untargeted.length
            ? untargeted
            : [
                ...room.find(FIND_TOMBSTONES),
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
                    && c.state.mode === "collect"
                    && !c.state.isWalking
                    && (("sourceId" in c.state || "sourceCreepId" in c.state) && c.state.sourceDistance <= 1))
                .filter(c => {
                    const collectors = getTargetingCollectors(c.id)
                    return collectors.size == 0 || collectors.size == 1 && collectors.has(creep.id)
                })
                .map(c => c.creep)
                .filter(c => {
                    // We still need some time to arrive the target creep. Target can collect some more energy meanwhile.
                    const energyCap = c.store.getCapacity(RESOURCE_ENERGY);
                    const energyEst = Math.max(energyCap, c.store.energy + creep.pos.getRangeTo(c) * RANGE_DISTANCE_RATIO * c.getActiveBodyparts(WORK));
                    return energyEst / energyCap >= 0.6 || energyEst / creep.store.getCapacity(RESOURCE_ENERGY) >= 0.8
                })
                .value();
            // Also take a look at the storage at this point, before wandering away.
            // TODO schedule a proper storage-taking behavior.
            const storage = room.storage && room.storage.store.energy > creep.store.getCapacity(RESOURCE_ENERGY) * 0.8
                ? [/* room.storage */] : [];
            const secondary = collectingCreeps.length
                ? findNearestPath(creep.pos, [
                    ...storage,
                    ...collectingCreeps
                ], { maxRooms: 1 })
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
            this.state = { mode: "collect", resourceId: nearest.goal.id, targetId, nextEvalTime };
        else if (nearest.goal instanceof Tombstone || nearest.goal instanceof StructureStorage || nearest.goal instanceof Ruin)
            this.state = { mode: "collect", storageId: nearest.goal.id, targetId, sourceDistance: 0, nextEvalTime };
        else if (nearest.goal instanceof Source)
            this.state = { mode: "collect", sourceId: nearest.goal.id, targetId, sourceDistance: 0, nextEvalTime };
        else if (nearest.goal instanceof Creep) {
            const sourceCollector = getSpecializedCreep(nearest.goal, CollectorCreep);
            if (!sourceCollector) throw new Error("Unexpected null sourceCollector.");
            const sourceState = sourceCollector.state;
            if (sourceState.mode === "collect" && ("sourceId" in sourceState || "sourceCreepId" in sourceState)) {
                this.state = {
                    mode: "collect",
                    sourceCreepId: nearest.goal.id,
                    targetId,
                    sourceDistance: sourceState.sourceDistance + 1,
                    nextEvalTime
                };
            } else {
                throw new Error("Unexpected sourceCollector state.");
            }
        } else
            throw new Error("Unexpected code path.");
        this.assignPath(nearest.goal, nearest.path);
        return true;
    }
    private transitIdle(nextEvalTimeOffset?: number): boolean {
        this.state = { mode: "idle", nextEvalTime: nextEvalTimeOffset ?? (Game.time + _.random(5)) };
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
        if (!creep.store.energy) return false;
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
        if (state.mode === "distribute") {
            // Keep incremental state update if current is already in distribute state.
            if ("controllerId" in state) {
                const c = Game.getObjectById(state.controllerId);
                if (c?.my && this.assignPath(c))
                    return true;
            } else if ("constructionSiteId" in state) {
                const s = Game.getObjectById(state.constructionSiteId);
                if (s && s.progress < s.progressTotal && this.assignPath(s))
                    return true;
            } else if ("structureId" in state) {
                const st = Game.getObjectById(state.structureId);
                const minFreeCap = st instanceof StructureSpawn ? 10 : 0;
                if (st && ("store" in st && st.store.getFreeCapacity(RESOURCE_ENERGY) > minFreeCap || structureNeedsRepair(st))) {
                    if (this.assignPath(st)) return true;
                }
            }
        }
        const structures = _(room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_EXTENSION && s.my
                || s.structureType === STRUCTURE_TOWER && s.my
                || s.structureType === STRUCTURE_RAMPART && s.my
                || s.structureType === STRUCTURE_SPAWN && s.my
                || s.structureType === STRUCTURE_ROAD
                || s.structureType === STRUCTURE_WALL
                || s.structureType === STRUCTURE_CONTAINER
                || s.structureType === STRUCTURE_STORAGE
        }))
            .map(s => ({
                structure: s as CollectorCreepDistributeStructureType,
                needsRepair: structureNeedsRepair(s),
                storeVacancy: "store" in s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            }))
            .filter(e => !!e.needsRepair || e.storeVacancy)
            .value();
        const towers = structures.filter((s) => s.structure instanceof StructureTower);
        const { controller } = room;
        let controllerPriority: number;
        if (controller?.my) {
            const targetingCollectors = getTargetingCollectors(controller.id).size;
            if (targetingCollectors < 1 || controller.ticksToDowngrade <= 7200 && targetingCollectors < 4) {
                // Resetting downgrade timer is priority.
                controllerPriority = 1;
            } else if (targetingCollectors < 6) {
                controllerPriority = 0.5;
            } else if (targetingCollectors < 10) {
                controllerPriority = 0.1;
            } else {
                controllerPriority = 0;
            }
        } else {
            controllerPriority = 0;
        }
        const nextEvalTime = Game.time + _.random(4, 10);
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
                // Try some no-so-urgent stuff
                let targetGroups: [label: string, possibility: number, structures: { structure: CollectorCreepDistributeStructureType }[]][] = [
                    ["energy sink", 3, structures.filter(e =>
                        e.structure.structureType !== STRUCTURE_STORAGE
                        && e.structure.structureType !== STRUCTURE_CONTAINER
                        && canTransferEnergyToStructure(e.structure))],
                    ["fixable structure", 4, structures.filter(e => e.needsRepair === "yes")],
                    ["low-pri fixable structure", 2, _(structures).filter(e => e.needsRepair === "later").sampleSize(10).value()],
                    ["energy storage", 1, structures.filter(e => e.structure.structureType == STRUCTURE_STORAGE)],
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
                if (!nearest) return false;
            }
            const targetId = nearest.goal.id as Id<any>;
            this.logger.info(`Distribute ${nearest.goal}.`);
            if (nearest.goal instanceof ConstructionSite)
                this.state = { mode: "distribute", constructionSiteId: nearest.goal.id, targetId, nextEvalTime };
            else
                this.state = { mode: "distribute", structureId: nearest.goal.id as Id<any>, targetId, nextEvalTime };
            this.assignPath(nearest.goal, nearest.path);
            return true;
        }
        if (controller?.my) {
            this.state = { mode: "distribute", controllerId: controller.id, targetId: controller.id, nextEvalTime }
            if (!this.assignPath(controller)) {
                this.logger.warning(`Failed to arrange a path to the controller: ${controller}.`);
                return false;
            }
            return true;
        }
        return false;
    }
    private checkEnergyConstraint(): boolean {
        const { creep, state } = this;
        switch (state.mode) {
            case "idle":
                return true;
            case "collect":
                if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
                    this.logger.trace("Reached max energy cap. transitDistribute.");
                    this.transitDistribute() || this.transitIdle();
                    return false;
                }
                return true;
            case "distribute":
                if (!creep.store.energy) {
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
        if (state.mode !== "idle") throw new Error("Invalid state.");
        if (Game.time < state.nextEvalTime) {
            creep.say(`Idle${state.nextEvalTime - Game.time}`);
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
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "collect") throw new Error("Invalid state.");
        let result;
        let target;
        if ("resourceId" in state) {
            const resource = target = Game.getObjectById(state.resourceId);
            result = resource ? creep.pickup(resource) : undefined;
            this.logger.trace(`nextFrameCollect: creep.pickup -> ${result}.`);
        } else if ("storageId" in state) {
            const storage = target = Game.getObjectById(state.storageId);
            result = storage ? creep.withdraw(storage, RESOURCE_ENERGY) : undefined;
            this.logger.trace(`nextFrameCollect: creep.withdraw -> ${result}.`);
        } else if ("sourceCreepId" in state) {
            const sc = target = Game.getObjectById(state.sourceCreepId);
            const scollector = sc && getSpecializedCreep(sc, CollectorCreep);
            const scstate = scollector?.state;
            if (scstate?.mode == "collect" && "sourceDistance" in scstate && scstate.sourceDistance < state.sourceDistance) {
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
                this.logger.info(`nextFrameCollect: sourceCreep ${sc} changed source: mode=${scstate?.mode}.`);
            }
        } else {
            const source = target = Game.getObjectById(state.sourceId);
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
                || Game.time >= state.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
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
        if (!this.checkEnergyConstraint()) return;
        const { creep, state } = this;
        if (state.mode !== "distribute") throw new Error("Invalid state.");
        let result;
        let target;
        if ("constructionSiteId" in state) {
            const constructionSite = target = Game.getObjectById(state.constructionSiteId);
            result = constructionSite ? creep.build(constructionSite) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.build -> ${result}.`);
        } else if ("structureId" in state) {
            const st = target = Game.getObjectById(state.structureId);
            if (!st) {
                result = undefined
            } else {
                const needsRepair = st && structureNeedsRepair(st);
                const freeCap = "store" in st ? st.store.getFreeCapacity(RESOURCE_ENERGY) : 0;
                if (needsRepair === "now" || needsRepair && !freeCap) {
                    // Fix construct, if it needs fixing or we have more energy.
                    result = creep.repair(st);
                    this.logger.trace(`nextFrameDistribute: creep.repair(${st}) -> ${result}.`);
                } else {
                    result = creep.transfer(st, RESOURCE_ENERGY);
                    this.logger.trace(`nextFrameDistribute: creep.transfer -> ${result}.`);
                }
            }
        } else {
            const controller = target = Game.getObjectById(state.controllerId);
            result = controller ? creep.upgradeController(controller) : undefined;
            this.logger.trace(`nextFrameDistribute: creep.upgradeController -> ${result}.`);
        }
        state.isWalking = result === ERR_NOT_IN_RANGE;
        if (result == null || result === ERR_NOT_IN_RANGE || result == ERR_INVALID_TARGET) {
            if (
                // target is gone.
                !target
                // Need to prepare next path.
                || Game.time >= state.nextEvalTime && (!creep.fatigue || creep.fatigue <= 4 && _.random(4) === 0)
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
            if (!this.transitCollect)
                this.transitIdle();
            return;
        }
        if (result === ERR_FULL) {
            if (creep.store.energy > 25 && this.transitDistribute()) return;
            if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && this.transitCollect()) return;
            this.transitIdle();
            return;
        }
    }
}

initializeTargetTracking(CollectorCreep);
