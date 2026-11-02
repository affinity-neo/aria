import Foundation
import EventKit

struct Config: Codable {
    let endpoint: String
    let listName: String
}

@main
struct AriaRemindersSync {
    static let store = EKEventStore()
    static let configDir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/aria-reminders", isDirectory: true)

    static func main() async {
        do {
            try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
            let config = try loadOrCreateConfig()
            let granted = try await store.requestFullAccessToReminders()
            guard granted else {
                print("❌ 미리 알림 접근 권한이 허용되지 않았어요. 시스템 설정 > 개인정보 보호 및 보안 > 미리 알림에서 Terminal 권한을 켜주세요.")
                return
            }

            print("✅ Apple 미리 알림 접근 권한 확인")
            print("📥 '\(config.listName)' 목록을 감시합니다.")
            print("현재 목록의 미완료 항목만 ARIA에 유지합니다. Apple에서 삭제하거나 완료하면 ARIA에서도 사라집니다.")
            print("종료하려면 Control + C를 누르세요.\n")

            while true {
                await syncOnce(config: config)
                try? await Task.sleep(for: .seconds(10))
            }
        } catch {
            print("❌ 오류: \(error.localizedDescription)")
        }
    }

    static func loadOrCreateConfig() throws -> Config {
        let file = configDir.appendingPathComponent("config.json")
        if FileManager.default.fileExists(atPath: file.path) {
            let data = try Data(contentsOf: file)
            return try JSONDecoder().decode(Config.self, from: data)
        }

        print("ARIA 웹사이트 > 빠른 메모 >  미리 알림 연결에서 '요청 URL'을 복사해 붙여넣으세요.")
        print("요청 URL:")
        guard let endpoint = readLine()?.trimmingCharacters(in: .whitespacesAndNewlines),
              endpoint.hasPrefix("https://"), endpoint.hasSuffix(".json") else {
            throw NSError(domain: "AriaSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "올바른 Firebase 요청 URL이 아니에요."])
        }
        let config = Config(endpoint: endpoint, listName: "ARIA")
        let data = try JSONEncoder().encode(config)
        try data.write(to: file, options: .atomic)
        print("🔐 연결 주소를 \(file.path)에 저장했어요. 다른 사람과 공유하지 마세요.\n")
        return config
    }

    static func syncOnce(config: Config) async {
        guard let calendar = store.calendars(for: .reminder).first(where: { $0.title == config.listName }) else {
            print("⚠️ '\(config.listName)' 목록을 찾지 못했어요. 목록 이름을 확인하세요.")
            return
        }

        let predicate = store.predicateForReminders(in: [calendar])
        let reminders: [EKReminder] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { items in
                continuation.resume(returning: items ?? [])
            }
        }

        var current: [String: [String: Any]] = [:]
        for reminder in reminders where !reminder.isCompleted {
            let identifier = reminder.calendarItemIdentifier
            guard let title = reminder.title?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !title.isEmpty else { continue }

            let formatter = ISO8601DateFormatter()
            current[identifier] = [
                "title": title,
                "notes": reminder.notes ?? "",
                "list": config.listName,
                "priority": String(reminder.priority),
                "createdDate": formatter.string(from: reminder.creationDate ?? Date())
            ]
        }

        do {
            var request = URLRequest(url: URL(string: config.endpoint)!)
            request.httpMethod = "PUT"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: current, options: [.fragmentsAllowed])
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "AriaSync", code: 2, userInfo: [NSLocalizedDescriptionKey: "Firebase 전송에 실패했어요."])
            }
        } catch {
            print("⚠️ 동기화 실패: \(error.localizedDescription)")
        }
    }
}
