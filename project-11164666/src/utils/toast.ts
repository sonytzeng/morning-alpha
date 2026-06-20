let toastCounter = 0;

export function showToast(message: string, type: 'success' | 'error' = 'success') {
  const id = ++toastCounter;

  const wrapper = document.createElement('div');
  wrapper.id = `toast-${id}`;
  wrapper.className =
    'fixed bottom-6 left-1/2 z-[9999] flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all duration-300 pointer-events-none whitespace-nowrap';
  wrapper.style.transform = 'translateX(-50%) translateY(16px)';
  wrapper.style.opacity = '0';
  wrapper.style.backgroundColor = type === 'success' ? '#059669' : '#ef4444';
  wrapper.style.color = '#ffffff';
  wrapper.style.minWidth = '200px';
  wrapper.style.justifyContent = 'center';

  const icon = document.createElement('i');
  icon.className = type === 'success' ? 'ri-check-line' : 'ri-error-warning-line';
  icon.style.fontSize = '16px';

  const text = document.createElement('span');
  text.textContent = message;

  wrapper.appendChild(icon);
  wrapper.appendChild(text);
  document.body.appendChild(wrapper);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrapper.style.transform = 'translateX(-50%) translateY(0)';
      wrapper.style.opacity = '1';
    });
  });

  // Remove after delay
  setTimeout(() => {
    wrapper.style.transform = 'translateX(-50%) translateY(16px)';
    wrapper.style.opacity = '0';
    setTimeout(() => {
      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    }, 300);
  }, 3000);
}