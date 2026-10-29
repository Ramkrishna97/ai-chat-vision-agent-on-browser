// JavaScript app to check current time and calculate time left till midnight
const now = new Date();

function formatTime(hours, minutes, seconds) {
    const hoursStr = hours < 12 ? `${hours.toString().padStart(2, '0')}:00` : hours.toString();
    const minutesStr = minutes < 60 ? `${minutes.toString().padStart(2, '0')}:00` : minutes.toString();
    const secondsStr = seconds < 60 ? `${seconds.toString().padStart(2, '0')}:00` : seconds.toString();
    return `${hoursStr}:${minutesStr}:${secondsStr}`;
}

function calculateTimeLeft() {
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();

    const timeLeft = formatTime(
        24 - currentHours, 
        60 - currentMinutes, 
        60 - currentSeconds
    );
    return timeLeft;
}

document.addEventListener('DOMContentLoaded', () => {
    const result = calculateTimeLeft();
    console.log(`Current time: ${formatTime(currentHours, currentMinutes, currentSeconds)}`);
    console.log(`Time left till midnight: ${result}`);
});
