import Foundation

/// The weather mod's answer (editor/scripts/weather.py resolve: the agent picks forecast ids, the server fills in their values): the
/// periods asked about (`forecast`), the finer samples to play through (`timeline`), and how to preview them.
struct WeatherData: Decodable, Equatable {
    struct Entry: Decodable, Equatable {
        let id: String
        let date: String
        let time: String?
        let local_time: String?
        let period: String?
        let summary: String?
        let temp_c: Double?
        let condition: String          // clear, partly_cloudy, cloudy, rain, snow, fog, storm
        let night: Bool?
        let intensity: Double?
        var isNight: Bool { night ?? false }
        var label: String {
            let when = local_time ?? time ?? period ?? ""
            return [date, when, summary ?? condition.replacingOccurrences(of: "_", with: " "), temp_c.map { String(format: "%.0f °C", $0) }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
    }
    struct Preview: Decodable, Equatable { let component: String?; let seconds_per_period: Double?; let dates: [String]? }
    let forecast: [Entry]
    let timeline: [Entry]?
    let preview: Preview?
    /// What plays: the timeline, else the forecast.
    var entries: [Entry] { (timeline?.isEmpty == false ? timeline : nil) ?? forecast }
    var secondsPerPeriod: Double { preview?.seconds_per_period ?? 8 }
}
