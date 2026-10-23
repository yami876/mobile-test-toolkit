# -*- coding: utf-8 -*-
"""
iOS / iPadOS 设备信息采集（由 采集设备信息.py 调用，也可单独 import 使用）

依赖：pip install pymobiledevice3；Windows 需安装 iTunes 或爱思助手等带苹果驱动的软件
手机/平板需解锁并点「信任此电脑」

系统可直接读到：序列号、型号号码+区域、系统版本、存储容量、分辨率、WLAN/蓝牙 MAC、CPU 架构
苹果不开放的参数（芯片、GPU、内存、尺寸、刷新率、蓝牙版本、上市日期）按下方机型表填写
"""
import asyncio
import inspect
import warnings

# 机型表：内部标识 → (名称, 芯片, GPU, 运行内存, 主屏尺寸, 刷新率, 屏幕形态, 蓝牙, 上市日期)
# 运行内存写成 "8G/16G" 表示存储 1T 及以上的版本为后者
_iPhone = {
    ("iPhone8,2",): ("iPhone 6s Plus", "A9", "PowerVR GT7600 6核", "2G", "5.5", 60, "Home键", "4.2", "2015-09"),
    ("iPhone10,1", "iPhone10,4"): ("iPhone 8", "A11", "3核", "2G", "4.7", 60, "Home键", "5.0", "2017-09"),
    ("iPhone11,2",): ("iPhone XS", "A12", "4核", "4G", "5.8", 60, "刘海", "5.0", "2018-09"),
    ("iPhone11,4", "iPhone11,6"): ("iPhone XS Max", "A12", "4核", "4G", "6.5", 60, "刘海", "5.0", "2018-09"),
    ("iPhone11,8",): ("iPhone XR", "A12", "4核", "3G", "6.1", 60, "刘海", "5.0", "2018-10"),
    ("iPhone12,1",): ("iPhone 11", "A13", "4核", "4G", "6.1", 60, "刘海", "5.0", "2019-09"),
    ("iPhone12,3",): ("iPhone 11 Pro", "A13", "4核", "4G", "5.8", 60, "刘海", "5.0", "2019-09"),
    ("iPhone12,5",): ("iPhone 11 Pro Max", "A13", "4核", "4G", "6.5", 60, "刘海", "5.0", "2019-09"),
    ("iPhone12,8",): ("iPhone SE (第2代)", "A13", "4核", "3G", "4.7", 60, "Home键", "5.0", "2020-04"),
    ("iPhone13,1",): ("iPhone 12 mini", "A14", "4核", "4G", "5.4", 60, "刘海", "5.0", "2020-11"),
    ("iPhone13,2",): ("iPhone 12", "A14", "4核", "4G", "6.1", 60, "刘海", "5.0", "2020-10"),
    ("iPhone13,3",): ("iPhone 12 Pro", "A14", "4核", "6G", "6.1", 60, "刘海", "5.0", "2020-10"),
    ("iPhone13,4",): ("iPhone 12 Pro Max", "A14", "4核", "6G", "6.7", 60, "刘海", "5.0", "2020-11"),
    ("iPhone14,4",): ("iPhone 13 mini", "A15", "4核", "4G", "5.4", 60, "刘海", "5.0", "2021-09"),
    ("iPhone14,5",): ("iPhone 13", "A15", "4核", "4G", "6.1", 60, "刘海", "5.0", "2021-09"),
    ("iPhone14,2",): ("iPhone 13 Pro", "A15", "5核", "6G", "6.1", 120, "刘海", "5.0", "2021-09"),
    ("iPhone14,3",): ("iPhone 13 Pro Max", "A15", "5核", "6G", "6.7", 120, "刘海", "5.0", "2021-09"),
    ("iPhone14,6",): ("iPhone SE (第3代)", "A15", "4核", "4G", "4.7", 60, "Home键", "5.0", "2022-03"),
    ("iPhone14,7",): ("iPhone 14", "A15", "5核", "6G", "6.1", 60, "刘海", "5.3", "2022-09"),
    ("iPhone14,8",): ("iPhone 14 Plus", "A15", "5核", "6G", "6.7", 60, "刘海", "5.3", "2022-10"),
    ("iPhone15,2",): ("iPhone 14 Pro", "A16", "5核", "6G", "6.1", 120, "灵动岛", "5.3", "2022-09"),
    ("iPhone15,3",): ("iPhone 14 Pro Max", "A16", "5核", "6G", "6.7", 120, "灵动岛", "5.3", "2022-09"),
    ("iPhone15,4",): ("iPhone 15", "A16", "5核", "6G", "6.1", 60, "灵动岛", "5.3", "2023-09"),
    ("iPhone15,5",): ("iPhone 15 Plus", "A16", "5核", "6G", "6.7", 60, "灵动岛", "5.3", "2023-09"),
    ("iPhone16,1",): ("iPhone 15 Pro", "A17 Pro", "6核", "8G", "6.1", 120, "灵动岛", "5.3", "2023-09"),
    ("iPhone16,2",): ("iPhone 15 Pro Max", "A17 Pro", "6核", "8G", "6.7", 120, "灵动岛", "5.3", "2023-09"),
    ("iPhone17,3",): ("iPhone 16", "A18", "5核", "8G", "6.1", 60, "灵动岛", "5.3", "2024-09"),
    ("iPhone17,4",): ("iPhone 16 Plus", "A18", "5核", "8G", "6.7", 60, "灵动岛", "5.3", "2024-09"),
    ("iPhone17,1",): ("iPhone 16 Pro", "A18 Pro", "6核", "8G", "6.3", 120, "灵动岛", "5.3", "2024-09"),
    ("iPhone17,2",): ("iPhone 16 Pro Max", "A18 Pro", "6核", "8G", "6.9", 120, "灵动岛", "5.3", "2024-09"),
    ("iPhone17,5",): ("iPhone 16e", "A18", "4核", "8G", "6.1", 60, "刘海", "5.3", "2025-02"),
    ("iPhone18,3",): ("iPhone 17", "A19", "5核", "8G", "6.3", 120, "灵动岛", "6.0", "2025-09"),
    ("iPhone18,4",): ("iPhone Air", "A19 Pro", "5核", "12G", "6.5", 120, "灵动岛", "6.0", "2025-09"),
    ("iPhone18,1",): ("iPhone 17 Pro", "A19 Pro", "6核", "12G", "6.3", 120, "灵动岛", "6.0", "2025-09"),
    ("iPhone18,2",): ("iPhone 17 Pro Max", "A19 Pro", "6核", "12G", "6.9", 120, "灵动岛", "6.0", "2025-09"),
}
_iPad = {
    ("iPad4,4", "iPad4,5", "iPad4,6"): ("iPad mini 2", "A7", "PowerVR G6430 4核", "1G", "7.9", 60, "Home键", "4.0", "2013-11"),
    ("iPad5,1", "iPad5,2"): ("iPad mini 4", "A8", "PowerVR GX6450 4核", "2G", "7.9", 60, "Home键", "4.2", "2015-09"),
    ("iPad5,3", "iPad5,4"): ("iPad Air 2", "A8X", "PowerVR GXA6850 8核", "2G", "9.7", 60, "Home键", "4.2", "2014-10"),
    ("iPad7,3", "iPad7,4"): ("iPad Pro 10.5英寸", "A10X", "12核", "4G", "10.5", 120, "Home键", "4.2", "2017-06"),
    ("iPad8,5", "iPad8,6", "iPad8,7", "iPad8,8"):
        ("iPad Pro 12.9英寸 (第3代)", "A12X", "7核", "4G/6G", "12.9", 120, "平板", "5.0", "2018-11"),
    ("iPad6,11", "iPad6,12"): ("iPad (第5代)", "A9", "PowerVR GT7600 6核", "2G", "9.7", 60, "Home键", "4.2", "2017-03"),
    ("iPad11,6", "iPad11,7"): ("iPad (第8代)", "A12", "4核", "3G", "10.2", 60, "Home键", "4.2", "2020-09"),
    ("iPad12,1", "iPad12,2"): ("iPad (第9代)", "A13", "4核", "3G", "10.2", 60, "Home键", "4.2", "2021-09"),
    ("iPad13,18", "iPad13,19"): ("iPad (第10代)", "A14", "4核", "4G", "10.9", 60, "平板", "5.2", "2022-10"),
    ("iPad15,7", "iPad15,8"): ("iPad (A16)", "A16", "4核", "6G", "11", 60, "平板", "5.3", "2025-03"),
    ("iPad11,3", "iPad11,4"): ("iPad Air (第3代)", "A12", "4核", "3G", "10.5", 60, "Home键", "5.0", "2019-03"),
    ("iPad13,1", "iPad13,2"): ("iPad Air (第4代)", "A14", "4核", "4G", "10.9", 60, "平板", "5.0", "2020-10"),
    ("iPad13,16", "iPad13,17"): ("iPad Air (第5代)", "M1", "8核", "8G", "10.9", 60, "平板", "5.0", "2022-03"),
    ("iPad14,8", "iPad14,9"): ("iPad Air 11英寸 (M2)", "M2", "9核", "8G", "11", 60, "平板", "5.3", "2024-05"),
    ("iPad14,10", "iPad14,11"): ("iPad Air 13英寸 (M2)", "M2", "9核", "8G", "13", 60, "平板", "5.3", "2024-05"),
    ("iPad15,3", "iPad15,4"): ("iPad Air 11英寸 (M3)", "M3", "9核", "8G", "11", 60, "平板", "5.3", "2025-03"),
    ("iPad15,5", "iPad15,6"): ("iPad Air 13英寸 (M3)", "M3", "9核", "8G", "13", 60, "平板", "5.3", "2025-03"),
    ("iPad14,1", "iPad14,2"): ("iPad mini (第6代)", "A15", "5核", "4G", "8.3", 60, "平板", "5.0", "2021-09"),
    ("iPad16,1", "iPad16,2"): ("iPad mini (A17 Pro)", "A17 Pro", "5核", "8G", "8.3", 60, "平板", "5.3", "2024-10"),
    ("iPad13,4", "iPad13,5", "iPad13,6", "iPad13,7"):
        ("iPad Pro 11英寸 (第3代)", "M1", "8核", "8G/16G", "11", 120, "平板", "5.0", "2021-05"),
    ("iPad13,8", "iPad13,9", "iPad13,10", "iPad13,11"):
        ("iPad Pro 12.9英寸 (第5代)", "M1", "8核", "8G/16G", "12.9", 120, "平板", "5.0", "2021-05"),
    ("iPad14,3", "iPad14,4"): ("iPad Pro 11英寸 (第4代)", "M2", "10核", "8G/16G", "11", 120, "平板", "5.3", "2022-10"),
    ("iPad14,5", "iPad14,6"): ("iPad Pro 12.9英寸 (第6代)", "M2", "10核", "8G/16G", "12.9", 120, "平板", "5.3", "2022-10"),
    ("iPad16,3", "iPad16,4"): ("iPad Pro 11英寸 (M4)", "M4", "10核", "8G/16G", "11", 120, "平板", "5.3", "2024-05"),
    ("iPad16,10", "iPad16,11"): ("iPad Air 13英寸 (M4)", "M4", "9核", "12G", "13", 60, "平板", "6.0", "2026-03"),
    ("iPad17,1", "iPad17,2"): ("iPad Pro 11英寸 (M5)", "M5", "10核", "12G/16G", "11", 120, "平板", "6.0", "2025-10"),
    ("iPad17,3", "iPad17,4"): ("iPad Pro 13英寸 (M5)", "M5", "10核", "12G/16G", "13", 120, "平板", "6.0", "2025-10"),
    ("iPad16,5", "iPad16,6"): ("iPad Pro 13英寸 (M4)", "M4", "10核", "8G/16G", "13", 120, "平板", "5.3", "2024-05"),
}
机型表 = {标识: 参数 for 表 in (_iPhone, _iPad) for 键, 参数 in 表.items() for 标识 in 键}

高端芯片 = {"A15", "A16", "A17 Pro", "A18", "A18 Pro", "A19", "A19 Pro", "M1", "M2", "M3", "M4", "M5"}
中端芯片 = {"A13", "A14", "A12X"}
# 不支持任何代 Apple Pencil 的 iPad
不支持笔 = {"iPad4,4", "iPad4,5", "iPad4,6", "iPad5,1", "iPad5,2", "iPad5,3", "iPad5,4", "iPad6,11", "iPad6,12"}
# 按机型单独指定档位（入门款芯片虽新，但 GPU/内存缩水）
档位覆盖 = {"iPad (A16)": "中端"}
存储档位 = [16, 32, 64, 128, 256, 512, 1024, 2048]


async def _取(x):
    x = x() if callable(x) else x
    return await x if inspect.isawaitable(x) else x


def _存储标称(字节数):
    GB = 字节数 / 1e9  # 苹果按十进制计容量
    for 档 in 存储档位:
        if GB <= 档 * 1.02:
            return 档
    return round(GB)


def _容错保存配对记录():
    """配对记录同步给苹果驱动失败时不中断采集。

    设备重置或重新信任后，Windows 上苹果驱动无法覆盖旧的配对记录文件
    （C:\\ProgramData\\Apple\\Lockdown，需管理员权限），会报错 183（文件已存在）。
    本地缓存那份已保存成功，本次读取不受影响，所以跳过同步失败。
    """
    from pymobiledevice3 import lockdown

    原方法 = lockdown.PlistUsbmuxLockdownClient.save_pair_record
    if getattr(原方法, "_已容错", False):
        return

    async def 保存(self):
        try:
            await 原方法(self)
        except Exception as e:
            print(f"   ℹ 配对记录未能同步给苹果驱动（{e}），不影响本次采集")

    保存._已容错 = True
    lockdown.PlistUsbmuxLockdownClient.save_pair_record = 保存


async def _采集全部():
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.usbmux import list_devices

    _容错保存配对记录()

    结果 = []
    for 设备 in await _取(list_devices()):
        print(f"\n▶ 正在采集 iOS 设备 {设备.serial} ...")
        try:
            连接 = await _取(create_using_usbmux(serial=设备.serial))
            值 = await _取(连接.all_values)
            磁盘 = await _取(连接.get_value(domain="com.apple.disk_usage")) or {}
            显示 = await _取(连接.get_value(domain="com.apple.mobile.iTunes")) or {}
        except Exception as e:
            print(f"⚠ {设备.serial}：读取失败（{e}），请解锁设备并点「信任此电脑」")
            continue
        结果.append(_整理(值, 磁盘, 显示))
    return 结果


def _整理(值, 磁盘, 显示):
    标识 = 值.get("ProductType", "")
    类别 = 值.get("DeviceClass", "")
    序列号 = 值.get("SerialNumber", "")
    区域码 = 值.get("RegionInfo", "")
    存储GB = _存储标称(磁盘.get("TotalDiskCapacity", 0)) if 磁盘.get("TotalDiskCapacity") else 0
    宽, 高 = 显示.get("ScreenWidth"), 显示.get("ScreenHeight")
    系统名 = "iPadOS" if 类别 == "iPad" else "iOS"

    参数 = 机型表.get(标识)
    备注 = []
    if 参数:
        名称, 芯片, GPU核, 内存, 尺寸, 刷新率, 形态, 蓝牙, 上市 = 参数
        if "/" in 内存:
            内存 = 内存.split("/")[1] if 存储GB >= 1024 else 内存.split("/")[0]
        档位 = 档位覆盖.get(名称) or ("高端" if 芯片 in 高端芯片 else ("中端" if 芯片 in 中端芯片 else "低端"))
    else:
        名称, 芯片, GPU核, 内存, 尺寸, 刷新率, 形态, 蓝牙, 上市, 档位 = (标识,) + ("",) * 9
        备注.append(f"机型 {标识} 未收录，请手工补充芯片/内存/尺寸等参数")

    信息 = {
        "设备型号": f"Apple {名称}" if 参数 else 标识,
        "设备类型": "平板" if 类别 == "iPad" else "手机",
        "型号代号": f"{值.get('ModelNumber', '')}{区域码}",
        "序列号": 序列号,
        "操作系统": f"{系统名} {值.get('ProductVersion', '')}",
        "CPU": f"Apple {芯片}" if 芯片 else "",
        # A10 及更早用 PowerVR GPU，机型表里直接写全名
        "GPU": (GPU核 if "PowerVR" in GPU核 else f"Apple GPU {GPU核}") if GPU核 else "",
        "运行内存": 内存,
        "存储容量": (f"{存储GB // 1024}T" if 存储GB >= 1024 else f"{存储GB}G") if 存储GB else "",
        "主屏尺寸": f"{尺寸}英寸" if 尺寸 else "",
        "分辨率": f"{min(宽, 高)}x{max(宽, 高)}" if 宽 and 高 else "",
        "蓝牙": 蓝牙,
        "系统mac地址": (值.get("WiFiAddress") or "").upper(),
        "上市日期": 上市,
        "CPU架构": 值.get("CPUArchitecture", ""),
        "WebView版本": "随系统",
        "刷新率": f"{刷新率}Hz" if 刷新率 else "",
        "蓝牙MAC": (值.get("BluetoothAddress") or "").upper(),
        "UDID": 值.get("UniqueDeviceID", ""),  # 打包测试版（Ad Hoc/开发证书）登记设备用
        "版本区域": ("国行" if 区域码 == "CH/A" else "海外") if 区域码 else "",
        # 蜂窝版会返回电话能力标记，且能读到 IMEI
        "网络版本": "蜂窝版" if 值.get("TelephonyCapability") or 值.get("InternationalMobileEquipmentIdentity")
                    else "WLAN版",
        "性能档位": 档位,
        "屏幕形态": 形态,
        # 除 iPad 第5代外均支持 Apple Pencil，苹果从不随机附带
        "手写笔": ("不支持" if 标识 in 不支持笔 else "支持（需另购）") if 类别 == "iPad" else "不支持",
        "采集备注": "；".join(备注),
    }
    for 键, v in 信息.items():
        print(f"   {键}：{v or '（未获取）'}")
    return 序列号, 信息


def 采集iOS设备():
    """返回 [(序列号, 信息字典)]；未安装依赖或无设备时返回空列表"""
    warnings.filterwarnings("ignore")  # 屏蔽依赖库版本告警，避免刷屏
    try:
        import pymobiledevice3  # noqa: F401
    except ImportError:
        return []
    try:
        return asyncio.run(_采集全部())
    except Exception as e:
        print(f"⚠ iOS 设备检测失败：{e}（Windows 需安装 iTunes 或爱思助手提供苹果驱动）")
        return []
