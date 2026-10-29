import java.util.Scanner;

public class TimeUntilMidnight {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        
        // Get the current time in MM/DD/YYYY format
        System.out.print("Enter current date (MM/DD/YYYY): ");
        String dateString = scanner.nextLine();
        
        try {
            int day = Integer.parseInt(dateString.substring(0, 2));
            int month = Integer.parseInt(dateString.substring(2, 4));
            int year = Integer.parseInt(dateString.substring(4, dateString.length()));
            
            // Calculate the time difference from current time to midnight
            long currentTime = System.currentTimeMillis();
            long days = (System.currentTimeMillis() / (1000 * 60 * 60 * 24)) - day * 24 * 365 * 24;
            
            long secondsUntilMidnight = currentTime - (days * 86400);
            
            // Display the time left
            long hours = secondsUntilMidnight / (60 * 60);
            long minutes = (secondsUntilMidnight % (60 * 60)) / 60;
            long seconds = secondsUntilMidnight % 60;
            
            System.out.println("Current time: " + dateString + " " + String.format("%02d:%02d:%02d", day, month, day));
            System.out.println("Time until midnight: " + hours + " hours, " + minutes + " minutes, " + seconds + " seconds");
            
        } catch (NumberFormatException e) {
            System.out.println("Error: Invalid date format. Please enter MM/DD/YYYY.");
        } finally {
            scanner.close();
        }
    }
}
