import dayjs from "dayjs";
import { getRustyMemory } from "src/memory";
import { Logger } from "./logger";

// 8 AM everyday
const NOTIFICATION_FLUSH_TIME = 0 * 3600 * 1000;
const NOTIFICATION_FLUSH_PERIOD = 24 * 3600 * 1000;
const NOTIFICATION_QUEUE_CAPACITY = 100;

const logger = new Logger("Rusty.Utility.Notifications");

interface RustyNotificationMemory {
    items: NotificationEntry[];
    lastFlushTime?: number;
    pendingDrainItems?: boolean;
}

interface NotificationEntry {
    startTime: number;
    startTick: number;
    endTick: number;
    count: number;
    message: string;
}

export interface NotificationOptions {
    isCritical?: boolean;
}

export function pushNotification(message: string, options?: NotificationOptions): void {
    const memory = getRustyMemory();
    if (!memory.notifications || typeof memory.notifications !== "object") {
        memory.notifications = {
            items: []
        } as RustyNotificationMemory;
    }
    const notifications = memory.notifications as RustyNotificationMemory;
    if (options?.isCritical) {
        Game.notify(message);
        return;
    }
    const item = notifications.items.find(i => i.startTick + 200 >= Game.time && i.message === message);
    if (item) {
        item.count++;
        item.endTick = Game.time;
        return;
    }
    notifications.items.push({
        startTime: Date.now(),
        startTick: Game.time,
        endTick: Game.time,
        count: 1,
        message
    });
}

export function flushNotifications(force?: boolean): void {
    const memory = getRustyMemory();
    const notifications = memory.notifications as RustyNotificationMemory;
    if (!notifications) return;
    let pushedCounter = 0;
    const now = Date.now();
    function formatTicks(startTick: number, endTick: number): string {
        if (startTick === endTick) return String(startTick);
        return `${startTick} ~ ${endTick}`;
    }
    if (force
        || notifications.items.length > NOTIFICATION_QUEUE_CAPACITY
        || notifications.pendingDrainItems
        || (notifications.lastFlushTime == null || ~~(notifications.lastFlushTime / NOTIFICATION_FLUSH_PERIOD) !== ~~(now / NOTIFICATION_FLUSH_PERIOD))
        && ~~(now % NOTIFICATION_FLUSH_PERIOD) >= NOTIFICATION_FLUSH_TIME) {
        let n: NotificationEntry | undefined;
        while (n = notifications.items.shift()) {
            if (pushedCounter >= 15) {
                notifications.pendingDrainItems = true;
                break;
            }
            Game.notify(`${dayjs(n.startTime).utc().format("YYYY-MM-DD HH:mm:ss")} T(${formatTicks(n.startTick, n.endTick)}) [x${n.count}] ${n.message}`);
            pushedCounter++;
        }
        if (notifications.items.length == 0) {
            notifications.pendingDrainItems = false;
        }
        notifications.lastFlushTime = Date.now();
        logger.info(`Flushed ${pushedCounter} notifications.`);
    }
}
