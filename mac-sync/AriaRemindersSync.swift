import Foundation
import EventKit

struct Config: Codable { let endpoint: String; let listName: String }
struct LocalState: Codable { var map: [String: String] = [:] }

@main
struct AriaRemindersSync {
    static let store = EKEventStore()
    static let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/aria-reminders", isDirectory: true)
    static let stateURL = dir.appendingPathComponent("two-way-state.json")
    static let session = URLSession.shared

    static func main() async {
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let config = try loadConfig()
            let granted = try await store.requestFullAccessToReminders()
            guard granted else { print("❌ 미리 알림 접근 권한을 허용해 주세요."); return }
            print("✅ 양방향 동기화 시작: Apple 미리 알림의 '\(config.listName)' 목록만 사용합니다.")
            print("ARIA에서 삭제/업무 이동하면 Apple에서도 삭제되고, 반대쪽 변경도 반영됩니다.")
            print("종료: Control + C\n")
            while true { await sync(config); try? await Task.sleep(for: .seconds(5)) }
        } catch { print("❌ 실행 오류: \(error.localizedDescription)") }
    }

    static func loadConfig() throws -> Config {
        let url = dir.appendingPathComponent("config.json")
        if FileManager.default.fileExists(atPath: url.path) {
            return try JSONDecoder().decode(Config.self, from: Data(contentsOf: url))
        }
        print("ARIA > 빠른 메모 > 미리 알림 연결의 요청 URL을 붙여넣으세요:")
        guard let value = readLine()?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.hasPrefix("https://"), value.hasSuffix(".json") else {
            throw NSError(domain: "AriaSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "Firebase 요청 URL이 올바르지 않습니다."])
        }
        let c = Config(endpoint: value, listName: "ARIA")
        try JSONEncoder().encode(c).write(to: url, options: .atomic)
        return c
    }

    static func loadState() -> LocalState {
        (try? JSONDecoder().decode(LocalState.self, from: Data(contentsOf: stateURL))) ?? LocalState()
    }
    static func saveState(_ state: LocalState) { try? JSONEncoder().encode(state).write(to: stateURL, options: .atomic) }

    static func request(_ url: URL, method: String = "GET", body: Any? = nil) async throws -> Any {
        var req = URLRequest(url: url); req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed, .sortedKeys]) }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "AriaSync", code: 2, userInfo: [NSLocalizedDescriptionKey: "Firebase 통신에 실패했습니다."])
        }
        return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) ?? NSNull()
    }
    static func itemURL(_ config: Config, _ id: String) -> URL {
        URL(string: config.endpoint.replacingOccurrences(of: ".json", with: "/items/\(id).json"))!
    }
    static func fetchItems(_ config: Config) async throws -> [String: [String: Any]] {
        let root = try await request(URL(string: config.endpoint)!)
        guard let dict = root as? [String: Any] else { return [:] }
        var result = dict["items"] as? [String: [String: Any]] ?? [:]
        // Migrate records written by the earlier one-way helper (root-level EventKit IDs).
        for (key, value) in dict where key != "items" {
            if let item = value as? [String: Any], item["list"] as? String == "ARIA", item["title"] is String {
                if result[key] == nil { result[key] = item }
            }
        }
        return result
    }
    static func write(_ item: [String: Any], id: String, config: Config) async {
        _ = try? await request(itemURL(config, id), method: "PUT", body: item)
    }
    static func fetchReminders(_ calendar: EKCalendar) async -> [EKReminder] {
        let p = store.predicateForReminders(in: [calendar])
        return await withCheckedContinuation { c in store.fetchReminders(matching: p) { c.resume(returning: $0 ?? []) } }
    }
    static func sync(_ config: Config) async {
        guard let calendar = store.calendars(for: .reminder).first(where: { $0.title == config.listName }) else {
            print("⚠️ '\(config.listName)' 목록을 찾을 수 없습니다."); return
        }
        do {
            var state = loadState()
            var remote = try await fetchItems(config)
            let reminders = await fetchReminders(calendar)
            let byIdentifier = Dictionary(uniqueKeysWithValues: reminders.map { ($0.calendarItemIdentifier, $0) })
            var changedState = false
            // Preserve the old EventKit identifier as the remote ID during migration.
            for remoteID in remote.keys where state.map[remoteID] == nil && byIdentifier[remoteID] != nil {
                state.map[remoteID] = remoteID
                changedState = true
                if let item = remote[remoteID] { await write(item, id: remoteID, config: config) }
            }
            var deletedEventIDs = Set<String>()

            // Previously linked items missing from the ARIA list are deletions (including items moved to Recently Deleted).
            for (remoteID, eventID) in Array(state.map) where byIdentifier[eventID] == nil {
                if let old = remote[remoteID], old["deletedAt"] == nil {
                    var tomb = old
                    let now = Date().timeIntervalSince1970 * 1000
                    tomb["deletedAt"] = now; tomb["updatedAt"] = now
                    await write(tomb, id: remoteID, config: config); remote[remoteID] = tomb
                }
                deletedEventIDs.insert(eventID)
                state.map.removeValue(forKey: remoteID); changedState = true
            }

            // Apply remote changes or create reminders that originated in ARIA.
            for (remoteID, var item) in remote {
                if item["deletedAt"] != nil {
                    if let eventID = state.map[remoteID], let reminder = byIdentifier[eventID] {
                        try? store.remove(reminder, commit: false); try? store.commit()
                        deletedEventIDs.insert(eventID)
                    }
                    state.map.removeValue(forKey: remoteID); changedState = true
                    continue
                }
                guard let title = item["title"] as? String, !title.isEmpty else { continue }
                if let eventID = state.map[remoteID], let reminder = byIdentifier[eventID] {
                    let remoteTime = (item["updatedAt"] as? Double) ?? 0
                    let localTime = (reminder.lastModifiedDate?.timeIntervalSince1970 ?? 0) * 1000
                    if localTime > remoteTime + 1500 {
                        item = payload(reminder, list: config.listName, remoteID: remoteID)
                        await write(item, id: remoteID, config: config)
                    } else if remoteTime > localTime + 1500 || reminder.title != title || (reminder.notes ?? "") != (item["notes"] as? String ?? "") || reminder.isCompleted != (item["completed"] as? Bool ?? false) {
                        reminder.title = title; reminder.notes = item["notes"] as? String ?? ""
                        reminder.isCompleted = item["completed"] as? Bool ?? false
                        if let priority = item["priority"] as? Int { reminder.priority = priority }
                        try store.save(reminder, commit: true)
                    }
                } else {
                    let reminder = EKReminder(eventStore: store)
                    reminder.calendar = calendar; reminder.title = title
                    reminder.notes = item["notes"] as? String ?? ""
                    reminder.isCompleted = item["completed"] as? Bool ?? false
                    if let priority = item["priority"] as? Int { reminder.priority = priority }
                    try store.save(reminder, commit: true)
                    state.map[remoteID] = reminder.calendarItemIdentifier; changedState = true
                }
            }

            // Publish Apple-side additions not yet linked to a remote record.
            let mapped = Set(state.map.values)
            for reminder in reminders where !mapped.contains(reminder.calendarItemIdentifier) && !deletedEventIDs.contains(reminder.calendarItemIdentifier) {
                let remoteID = UUID().uuidString
                await write(payload(reminder, list: config.listName, remoteID: remoteID), id: remoteID, config: config)
                state.map[remoteID] = reminder.calendarItemIdentifier; changedState = true
            }
            if changedState { saveState(state) }
        } catch { print("⚠️ 동기화 오류: \(error.localizedDescription)") }
    }

    static func payload(_ reminder: EKReminder, list: String, remoteID: String) -> [String: Any] {
        let now = Date().timeIntervalSince1970 * 1000
        return ["id": remoteID, "title": reminder.title ?? "", "notes": reminder.notes ?? "",
                "list": list, "priority": reminder.priority, "completed": reminder.isCompleted,
                "completedAt": reminder.isCompleted ? now : 0, "updatedAt": max(now, (reminder.lastModifiedDate?.timeIntervalSince1970 ?? 0) * 1000),
                "createdDate": ISO8601DateFormatter().string(from: reminder.creationDate ?? Date())]
    }
}
