"""Local image picker and actual CLIP disaster classification."""
import queue
import threading
import tkinter as tk
from tkinter import filedialog, ttk
from PIL import Image, ImageTk, ImageOps


def main():
    root = tk.Tk()
    root.title('Disaster image classifier')
    root.geometry('940x760')
    ttk.Label(root, text='Disaster image classifier', font=('Segoe UI', 20)).pack(pady=14)
    ttk.Label(root, text='Flood • Fire • Earthquake damage • Landslide • Storm damage • Normal').pack()
    status = tk.StringVar(value='Choose an image to analyse. First use downloads the pretrained model.')
    result = tk.StringVar(value='')
    preview = ttk.Label(root, anchor='center')
    preview.pack(fill='both', expand=True, padx=20, pady=12)
    ttk.Label(root, textvariable=result, font=('Segoe UI', 18), wraplength=880).pack(pady=8)
    scores_text = tk.StringVar()
    ttk.Label(root, textvariable=scores_text, wraplength=880).pack(pady=8)
    ttk.Label(root, textvariable=status, wraplength=880).pack(pady=8)
    ttk.Label(root, text='Zero-shot pretrained model • Scores are relative matches, not measured accuracy.').pack(pady=8)
    messages = queue.Queue()
    detector = None

    def worker(path):
        nonlocal detector
        try:
            if detector is None:
                from disaster_zero_shot import ZeroShotDisasterDetector
                detector = ZeroShotDisasterDetector()
            import cv2
            import numpy as np
            with Image.open(path) as source:
                rgb = ImageOps.exif_transpose(source).convert('RGB')
                frame = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
            messages.put(('result', detector.predict_scores(frame)))
        except Exception as exc:
            messages.put(('error', str(exc)))

    def choose():
        path = filedialog.askopenfilename(title='Choose a disaster or normal image', filetypes=[('Images', '*.jpg *.jpeg *.png *.webp *.bmp'), ('All files', '*.*')])
        if not path:
            return
        try:
            with Image.open(path) as source:
                image = ImageOps.exif_transpose(source).convert('RGB')
                image.thumbnail((860, 420))
                preview.image = ImageTk.PhotoImage(image)
                preview.configure(image=preview.image)
        except Exception as exc:
            status.set('Cannot open image: ' + str(exc))
            return
        button.configure(state='disabled')
        result.set('Analysing image…')
        scores_text.set('')
        status.set('Loading model / analysing. The first model download can take several minutes.')
        threading.Thread(target=worker, args=(path,), daemon=True).start()

    button = ttk.Button(root, text='Choose image and analyse', command=choose)
    button.pack(pady=15)

    def poll():
        try:
            kind, data = messages.get_nowait()
            button.configure(state='normal')
            if kind == 'error':
                result.set('Analysis unavailable')
                status.set(data)
            else:
                ranked = sorted(data.items(), key=lambda item: item[1], reverse=True)
                label, score = ranked[0]
                uncertain = score < .40 or score - ranked[1][1] < .10
                result.set(('UNCERTAIN — closest match: ' if uncertain else 'Possible scene: ') + label.upper())
                scores_text.set('   |   '.join(f'{name}: {value:.0%}' for name, value in ranked))
                status.set('Analysis complete. Choose another image to test again.')
        except queue.Empty:
            pass
        root.after(100, poll)

    poll()
    root.mainloop()


if __name__ == '__main__':
    main()
