import _ from "lodash";
import { trySpawn } from "./spawn";
import { isSpecializedCreepOf } from "./specializedCreeps";
import { CollectorCreep, CollectorCreepVariant } from "./specializedCreeps/collector";
import { DefenderCreep } from "./specializedCreeps/defender";
import { getSpecializedCreep } from "./specializedCreeps/registry";
import { onNextFrame as onLinkNextFrame } from "./structures/link";
import { onNextFrame as onNukeNextFrame } from "./nuke";
import { Logger } from "./utility/logger";
import { visualTextMultiline } from "./utility/visual";
import dayjs from "dayjs";
import { getRoomConstructionMode, RoomConstructionMode } from "./specializedCreeps/collector/predicates";
import { pushNotification } from "./utility/notifications";

interface RustyRoomMemory {
    nextSpawnTime?: number;
}

interface RoomTransientState {
    decayingCreeps?: Id<Creep>[];
    expectedCollectors?: number[];
    actualCollectors?: number;
    collectorCreepCount?: Partial<Record<CollectorCreepVariant, number>>;
    defenderCount?: number;
    controllerLastLevel?: number;
    controllerUpgradeState?: "not-owned" | "no-upgrade" | {
        // Linear regression: y = a + bx
        progressRegressionParams: { n: number; sx: number; sy: number; sxy: number; sx2: number; a: number; b: number };
        progress: number;
        progressTotal: number;
        upgradeEta?: number;
    },
    constructionMode?: RoomConstructionMode;
}

const logger = new Logger("Rusty.Room");
const roomStateDict: Record<string, RoomTransientState> = {};
// estimated value.
const TICK_DURATION_SECONDS = 3.35;

export function onTowersNextFrame(room: Room, towers: StructureTower[]): void {
    var hostiles = room.find(FIND_HOSTILE_CREEPS);
    var healable = room.find(FIND_MY_CREEPS, { filter: c => c.ticksToLive != null && c.ticksToLive > 50 && c.hitsMax - c.hits >= 20 });
    if (hostiles.length) {
        const message = `Hostile (${hostiles.length}) ${_(hostiles).take(5).map(h => `[${h.name}|${h.owner.username}]`).join()} spotted in room ${room.name}.`;
        pushNotification(message, {
            isCritical: !!hostiles.find(h => h.owner.username !== "Invader")
        });
        logger.warning(message);
    }
    for (const tower of towers) {
        if (hostiles.length && (!healable.length || _.random(true) < 0.7)) {
            const target = _(hostiles).sample()!;
            tower.attack(target);
            continue;
        }
        if (healable.length) {
            const target = _(healable).maxBy(c => (c.hitsMax - c.hits) / c.hitsMax / tower.pos.getRangeTo(c))!;
            tower.heal(target);
            continue;
        }
    }
}

export function onRoomNextFrame(room: Room): void {
    if (typeof room.memory.rusty !== "object") room.memory.rusty = {};
    const roomState = roomStateDict[room.name] || (roomStateDict[room.name] = {});
    const rusty = room.memory.rusty as RustyRoomMemory;
    const towers = room.find(FIND_MY_STRUCTURES, { filter: { structureType: STRUCTURE_TOWER } }) as StructureTower[];
    const { controller } = room;
    onNukeNextFrame(room);
    if (towers.length) onTowersNextFrame(room, towers);
    const { nextSpawnTime } = rusty;
    if (nextSpawnTime == null || Game.time >= nextSpawnTime) {
        rusty.nextSpawnTime = Game.time + _.random(3, 10);
        // Find available spawns.
        const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
        if (spawns.length) {
            const sources = room.find(FIND_SOURCES_ACTIVE);
            const creeps = room.find(FIND_MY_CREEPS);
            const defenders = _(creeps).filter(c => isSpecializedCreepOf(c, DefenderCreep)).size();
            const collectors = _(creeps)
                .filter(c => isSpecializedCreepOf(c, CollectorCreep))
                .map(c => getSpecializedCreep(c, CollectorCreep)!).value();
            const collectorCount: Partial<Record<CollectorCreepVariant, number>>
                = roomState.collectorCreepCount
                = _(collectors).groupBy(c => c.variant).mapValues(g => g.length).value();
            roomState.defenderCount = defenders;
            // Do not need to spawn defender under safe mode, or when there is tower.
            if (!towers.length && collectors.length >= 1 && (!controller?.safeMode || controller.safeMode < 1500)) {
                if (defenders < 1) {
                    // Note: if you spawn twice, only the last spawn will be kept.
                    spawns.remove(trySpawn(spawns, s => DefenderCreep.spawn(s)));
                } else {
                    const hostileCreeps = room.find(FIND_HOSTILE_CREEPS).length;
                    if (hostileCreeps > 0 && defenders < hostileCreeps + 1) {
                        spawns.remove(trySpawn(spawns, s => DefenderCreep.spawn(s)));
                    }
                }
            }
            const expectedCollectors = roomState.expectedCollectors = [2,
                spawns.length * 3
                + sources.length * 8
                + (controller?.my ? 8 : 0)
                + 4
            ];
            if (controller?.my) {
                const progressRemaining = controller.progressTotal - controller.progress;
                if (progressRemaining < 1000)
                    expectedCollectors.push(15);
                else if (progressRemaining < 5000)
                    expectedCollectors.push(20);
                else
                    expectedCollectors.push(25);
            }
            const expc = Math.max(...expectedCollectors);
            const actc = roomState.actualCollectors
                = (collectorCount.normal || 0)
                + (collectorCount.tall || 0) * 1.3
                + (collectorCount.grande || 0) * 2
                + (collectorCount.venti || 0) * 3.2
                + (collectorCount.trenta || 0) * 4;
            if (actc < expc) {
                // Spawn collectors if necessary.
                spawns.remove(trySpawn(spawns, s => {
                    // Try spawn a bigger one first.
                    for (const variant of ["trenta", "venti", "grande", "tall"] as const) {
                        if (_.random(true) < 0.7) {
                            const r = CollectorCreep.spawn(s, variant);
                            if (typeof r === "string") return r;
                        }
                    }
                    return CollectorCreep.spawn(s, "normal");
                }));
            }
        }
    }
    onLinkNextFrame(room);
    // Update room indicator
    if (Game.time % 20 === 0) {
        const creeps = room.find(FIND_MY_CREEPS);
        const decayingCreeps = _(creeps).sortBy(c => c.ticksToLive).take(5).map(c => c.id).value();
        roomState.decayingCreeps = decayingCreeps;
    }
    if (controller?.my) {
        if (roomState.controllerLastLevel !== controller.level) {
            // Reset record after upgrade.
            roomState.controllerLastLevel = controller.level;
            delete roomState.controllerUpgradeState;
        }
        if (controller.progressTotal == null) {
            roomState.controllerUpgradeState = "no-upgrade";
        } else {
            let { controllerUpgradeState } = roomState;
            if (typeof controllerUpgradeState !== "object")
                controllerUpgradeState = roomState.controllerUpgradeState = {
                    progress: 0,
                    progressTotal: 0,
                    progressRegressionParams: { n: 0, sx: 0, sy: 0, sxy: 0, sx2: 0, a: 0, b: 0 },
                };
            controllerUpgradeState.progress = controller.progress;
            controllerUpgradeState.progressTotal = controller.progressTotal;
            const cprp = controllerUpgradeState.progressRegressionParams;
            cprp.n++;
            const n = cprp.n;
            cprp.sx += n;
            cprp.sx2 += n * n;
            const y = controller.progressTotal - controller.progress;
            cprp.sy += y;
            cprp.sxy += n * y;
            const { sx, sy, sx2, sxy } = cprp;
            const b = cprp.b = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
            const a = cprp.a = (sy - b * sx) / n;
            controllerUpgradeState.upgradeEta = n >= 3 ? Math.round(-a / b) - n : undefined;
        }
    } else {
        roomState.controllerUpgradeState = "not-owned";
    }
    roomState.constructionMode = getRoomConstructionMode(room);
}

function renderRoomStatus(room: Room): void {
    const {
        defenderCount: dc = "",
        collectorCreepCount: ccc = {},
        expectedCollectors: expc,
        actualCollectors: actc,
        decayingCreeps,
        controllerUpgradeState,
        constructionMode,
    } = roomStateDict[room.name] || {};
    const decayingCreepsExpr = _(decayingCreeps)
        .map(dc => Game.getObjectById(dc)).filter()
        .map(c => `  ${c!.name}\t${c!.ticksToLive}tks`);
    const controllerUpgradeExpr = (() => {
        if (controllerUpgradeState == null) return "N/A";
        if (controllerUpgradeState == "no-upgrade") return "(Not upgradable)";
        if (controllerUpgradeState == "not-owned") return "(Not owned)";
        const {
            progress: progress,
            progressTotal: total,
            upgradeEta: eta,
        } = controllerUpgradeState;
        let expr = `${progress}/${total} (${Math.round(progress / total * 1000) / 10}%)`;
        if (eta != null) {
            const etaDuration = dayjs.duration(eta * TICK_DURATION_SECONDS, "seconds").format();
            expr += ` ETA ${eta}tks (${etaDuration})`;
        }
        return expr;
    })();
    visualTextMultiline(room, [
        `Defenders: ${dc}`,
        `Collectors: ${_(ccc).values().sum()}(N:${ccc.normal || 0} T:${ccc.tall || 0} G:${ccc.grande || 0} V:${ccc.venti || 0} Tr:${ccc.trenta || 0}) (${actc && Math.round(actc * 10) / 10} / [${expc}])`,
        `Controller: ${controllerUpgradeExpr}`,
        `Construction mode: ${constructionMode}`,
        "",
        "Decaying creeps",
        ...decayingCreepsExpr
    ],
        1, 1, { align: "left", opacity: 0.4 }
    )
}

export function onNextFrame(): void {
    for (const room of _(Game.rooms).values()) {
        try {
            onRoomNextFrame(room);
            renderRoomStatus(room);
        } catch (err) {
            logger.error(`onNextFrame failed in ${room}.`, err);
        }
    }
}
