import Foundation
import UserNotifications

/// Schedules the daily reading reminder used by the gamification features.
///
/// The reminder is a single repeating calendar notification fired at the time
/// the user picks in Settings. Its copy nudges the user to keep their streak
/// alive; the live streak/goal numbers live in the app and widget.
enum NotificationManager {
    static let reminderId = "pq.daily.reminder"

    /// Asks the system for permission to show alerts. Returns whether it was
    /// granted. Safe to call repeatedly — the OS only prompts once.
    @discardableResult
    static func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = try? await center.requestAuthorization(
            options: [.alert, .sound, .badge])
        return granted ?? false
    }

    static func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current()
            .notificationSettings().authorizationStatus
    }

    /// (Re)schedules — or cancels — the daily reminder to match current
    /// settings. Call after launch and whenever the goal or reminder settings
    /// change.
    static func sync() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [reminderId])
        guard AppConfig.reminderEnabled else { return }

        let goal = AppConfig.dailyGoal
        let content = UNMutableNotificationContent()
        content.title = "Time to read"
        content.body = goal <= 1
            ? "Read a paper today to keep your streak alive."
            : "Read \(goal) papers today to hit your goal and keep your streak."
        content.sound = .default

        var when = DateComponents()
        when.hour = AppConfig.reminderHour
        when.minute = AppConfig.reminderMinute
        let trigger = UNCalendarNotificationTrigger(
            dateMatching: when, repeats: true)

        center.add(UNNotificationRequest(
            identifier: reminderId, content: content, trigger: trigger))
    }

    /// Turns the reminder on: requests permission, persists the flag, schedules.
    /// Returns whether permission was granted (the caller can reflect denial).
    @discardableResult
    static func enableReminder() async -> Bool {
        let granted = await requestAuthorization()
        AppConfig.reminderEnabled = granted
        sync()
        return granted
    }
}
