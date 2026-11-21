import { SessionBus, type DbusMessage } from "@main/utils/dbus";
import { trayLog } from "@main/utils/logger";

/** StatusNotifierWatcher 总线名 */
const WATCHER_NAME = "org.kde.StatusNotifierWatcher";

/** StatusNotifierWatcher 对象路径 */
const WATCHER_PATH = "/StatusNotifierWatcher";

/** StatusNotifierWatcher 接口名 */
const WATCHER_INTERFACE = "org.kde.StatusNotifierWatcher";

/** 托盘宿主导入完成信号 */
const HOST_REGISTERED_SIGNAL = "StatusNotifierHostRegistered";

/** 总线名持有者变化信号 */
const NAME_OWNER_CHANGED_SIGNAL = "NameOwnerChanged";

/**
 * 判断 Linux 托盘宿主是否已就绪
 * 宿主未注册时 Chromium 不会登记托盘图标，属性读取失败则按就绪处理
 * @param bus - 会话总线连接
 * @returns 是否已就绪
 */
const isHostReady = async (bus: SessionBus): Promise<boolean> => {
  if (!(await bus.nameHasOwner(WATCHER_NAME))) return false;
  const registered = await bus.getBoolProperty(
    WATCHER_NAME,
    WATCHER_PATH,
    WATCHER_INTERFACE,
    "IsStatusNotifierHostRegistered",
  );
  return registered !== false;
};

/**
 * 等待 Linux 托盘宿主就绪后回调一次
 * Chromium 只在创建 Tray 时检查一次 StatusNotifierWatcher，缺失时既不建监听也不会重试，
 * 因此在宿主出现之前不创建托盘
 * @param onReady - 宿主就绪时调用
 * @returns 取消等待的函数
 */
export const watchTrayHostReady = (onReady: () => void): (() => void) => {
  let bus: SessionBus | null = null;
  let settled = false;
  let waitingLogged = false;

  /**
   * 结束等待，就绪时创建托盘
   * @param ready - 是否可以创建托盘
   */
  const settle = (ready: boolean): void => {
    if (settled) return;
    settled = true;
    bus?.close();
    bus = null;
    if (ready) onReady();
  };

  /**
   * 查询宿主状态，未就绪时继续等待信号
   * @param connection - 会话总线连接
   */
  const check = (connection: SessionBus): void => {
    void isHostReady(connection)
      .then((ready) => {
        if (ready) {
          settle(true);
          return;
        }
        if (waitingLogged) return;
        waitingLogged = true;
        trayLog.info("未检测到 Linux 托盘宿主，等待其注册后再创建托盘");
      })
      .catch((error: unknown) => {
        trayLog.warn("托盘宿主检测失败，直接创建托盘", error);
        settle(true);
      });
  };

  void SessionBus.connect()
    .then(async (connection) => {
      if (settled) {
        connection.close();
        return;
      }
      bus = connection;
      connection.onClose(() => settle(true));
      connection.onSignal((message: DbusMessage) => {
        if (message.interface === WATCHER_INTERFACE && message.member === HOST_REGISTERED_SIGNAL) {
          settle(true);
        } else if (message.member === NAME_OWNER_CHANGED_SIGNAL) {
          check(connection);
        }
      });
      await connection.match(
        `type='signal',interface='org.freedesktop.DBus',member='${NAME_OWNER_CHANGED_SIGNAL}',arg0='${WATCHER_NAME}'`,
      );
      await connection.match(
        `type='signal',interface='${WATCHER_INTERFACE}',member='${HOST_REGISTERED_SIGNAL}'`,
      );
      check(connection);
    })
    .catch((error: unknown) => {
      trayLog.warn("无法监听 Linux 托盘宿主，直接创建托盘", error);
      settle(true);
    });

  return () => settle(false);
};
