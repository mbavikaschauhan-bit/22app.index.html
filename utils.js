// --- UTILITY FUNCTIONS ---
// Global UUID generator function
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = '';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    if (type === 'info') icon = 'info';
    toast.innerHTML = `<i data-feather="${icon}" class="h-5 w-5"></i><span>${message}</span>`;
    container.appendChild(toast);
    feather.replace();
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
};

const toggleSpinner = (button, show) => {
    const spinner = button.querySelector('.spinner');
    const btnText = button.querySelector('.btn-text');
    if (spinner && btnText) {
        spinner.classList.toggle('hidden', !show);
        btnText.classList.toggle('hidden', show);
    }
    button.disabled = show;
};

const formatCurrency = (value) => {
     return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value || 0);
};

// Format amount in compact format
const formatAmount = (value) => {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `₹${(value/1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `₹${(value/1_000).toFixed(1)}K`;
    return `₹${Math.round(value)}`;
};

const formatDate = (dateString, includeTime = false) => {
    if (!dateString) return '-';
    const d = new Date(dateString); // Supabase returns ISO strings
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }
    return d.toLocaleDateString('en-GB', options);
};

// Helper function to format date as DD-MM-YYYY
const formatDateDDMMYYYY = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    // Check if date is valid
    if (isNaN(d.getTime())) return dateString; // Return original string if invalid date
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
};

// Helper function to format date as DD-MM-YYYY for display (handles both YYYY-MM-DD and YYYY-MM-DDTHH:MM:SS formats)
const formatDateForDisplay = (dateString) => {
    if (!dateString) return '';
    
    // Handle both date-only and datetime formats
    let datePart;
    if (dateString.includes('T')) {
        // ISO datetime format: 2024-01-15T10:30:00
        datePart = dateString.split('T')[0];
    } else {
        // Date-only format: 2024-01-15
        datePart = dateString;
    }
    
    // Validate the date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        return dateString; // Return original if invalid format
    }
    
    // Convert YYYY-MM-DD to DD-MM-YYYY
    const [year, month, day] = datePart.split('-');
    return `${day}-${month}-${year}`;
};

// Helper function to format date in compact format for trade statement (DD/MM/YY)
const formatDateCompact = (dateString) => {
    if (!dateString) return '';
    
    // Handle both date-only and datetime formats
    let datePart;
    if (dateString.includes('T')) {
        // ISO datetime format: 2024-01-15T10:30:00
        datePart = dateString.split('T')[0];
    } else {
        // Date-only format: 2024-01-15
        datePart = dateString;
    }
    
    // Validate the date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        return dateString; // Return original if invalid format
    }
    
    // Convert YYYY-MM-DD to DD/MM/YY (compact format)
    const [year, month, day] = datePart.split('-');
    const shortYear = year.slice(-2); // Get last 2 digits of year
    return `${day}/${month}/${shortYear}`;
};

// Helper function to format date for input fields (preserves local date)
const formatDateForInput = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    
    // Use local date methods to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const countTradingDays = (startDate, endDate) => {
    let count = 0;
    const curDate = new Date(startDate.getTime());
    while (curDate <= endDate) {
        const dayOfWeek = curDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0=Sun, 6=Sat
            count++;
        }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
};

// Date parsing utility function for CSV
function parseCSVDate(dateString) {
    if (!dateString || dateString.trim() === '') return null;
    
    try {
        const date = dateString.trim();
        
        // Handle DD-MM-YYYY format
        if (date.includes('-') && date.split('-').length === 3) {
            const parts = date.split('-');
            if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
                // DD-MM-YYYY format
                const [day, month, year] = parts;
                return new Date(year, month - 1, day);
            } else if (parts[0].length === 4 && parts[1].length === 2 && parts[2].length === 2) {
                // YYYY-MM-DD format
                const [year, month, day] = parts;
                return new Date(year, month - 1, day);
            }
        }
        
        // Handle DD/MM/YYYY format
        if (date.includes('/') && date.split('/').length === 3) {
            const parts = date.split('/');
            if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
                // DD/MM/YYYY format
                const [day, month, year] = parts;
                return new Date(year, month - 1, day);
            }
        }
        
        // Fallback to native Date parsing
        return new Date(date);
    } catch (error) {
        console.warn('Invalid date format:', dateString);
        return null;
    }
}

// Export all utility functions to window for global access
window.utils = {
    generateUUID,
    showToast,
    toggleSpinner,
    formatCurrency,
    formatAmount,
    formatDate,
    formatDateDDMMYYYY,
    formatDateForDisplay,
    formatDateCompact,
    formatDateForInput,
    countTradingDays,
    parseCSVDate
};

