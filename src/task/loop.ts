import _ from "lodash";
import { Logger } from "src/utility/logger";
import { nextGameFrame } from "./async";
import { TaskBase, TaskType } from "./definitions/base";
import { FeedSpawnTask } from "./definitions/feedSpawn";
import { HarvestTask } from "./definitions/harvest";
import { SpawnCreepTask } from "./definitions/spawnCreep";
import { UpgradeControllerTask } from "./definitions/upgradeController";
import { ObjectScheduler } from "./objectScheduler";

const logger = new Logger("Rusty.Task.Loop");

const roomTasksMap = new Map<string, TaskBase[]>();
const creepScheduler = new ObjectScheduler();

export function* enumRunningTasks(): Iterable<TaskBase> {
    for (const tasks of roomTasksMap.values()) {
        for (const t of tasks) yield t;
    }
}

function roomScan(): void {
    logger.info("roomScan: Started.");
    for (const room of _(Game.rooms).values()) {
        let roomTasks = roomTasksMap.get(room.name)!;
        if (!roomTasks) {
            roomTasks = [];
            roomTasksMap.set(room.name, roomTasks);
        }
        const hasTask = (type: TaskType) => roomTasks.find(t => t instanceof type);
        const addTask = (task: TaskBase) => {
            logger.info(`roomScan: addTask ${task} in ${room}.`);
            roomTasks.push(task);
            task.disposal.subscribe(() => roomTasks.remove(task));
            task.start();
        };
        if (SpawnCreepTask.isApplicableToRoom(room.name) && !hasTask(SpawnCreepTask))
            addTask(new SpawnCreepTask(creepScheduler, room.name));
        if (FeedSpawnTask.isApplicableToRoom(room.name) && !hasTask(FeedSpawnTask))
            addTask(new FeedSpawnTask(creepScheduler, room.name));
        if (HarvestTask.isApplicableToRoom(room.name) && !hasTask(HarvestTask))
            addTask(new HarvestTask(creepScheduler, room.name));
        if (UpgradeControllerTask.isApplicableToRoom(room.name) && !hasTask(UpgradeControllerTask))
            addTask(new UpgradeControllerTask(creepScheduler, room.name));
    }
}

export async function loopAsync(): Promise<void> {
    logger.info("loopAsync: Started.");
    let nextRoomScanTick = Game.time;
    while (true) {
        const tick = Game.time;
        try {
            if (tick >= nextRoomScanTick) {
                nextRoomScanTick = tick + _.random(5, 15);
                roomScan();
            }
            creepScheduler.schedulePendingRequests();
        } catch (err) {
            logger.error("Error at tick", tick, err);
        }
        logger.info("loopAsync: Yield.");
        await nextGameFrame();
    }
}