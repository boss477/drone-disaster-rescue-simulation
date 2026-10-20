"""Desktop GUI for the zero-shot disaster image classifier.

    py image_upload_demo.py

Results are AI estimates, not verified emergency decisions.
"""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import filedialog, ttk

import disaster_zero_shot as dz


def main() -> None:
    root = tk.Tk()
    root.title("Disaster image classifier - AI estimate")
    root.geometry("940x820")

    ttk.Label(root, text="Disaster image classifier", font=("Segoe UI", 20)).pack(pady=(14, 2))
    ttk.Label(root, text="Flood • Fire • Earthquake damage • Landslide • Storm damage • Normal").pack()
    ttk.Label(
        root,
        text="AI ESTIMATE ONLY - not a verified emergency decision",
        foreground="#b45309",
        font=("Segoe UI", 10, "bold"),
    ).pack(pady=4)

    preview = ttk.Label(root, anchor="center")
    preview.pack(fill="both", expand=True, padx=20, pady=8)
    result = tk.StringVar()
    ttk.Label(root, textvariable=result, font=("Segoe UI", 17), wraplength=880).pack(pady=6)

    table = ttk.Treeview(root, columns=("category", "score"), show="headings", height=len(dz.LABELS))
    table.heading("category", text="Category")
    table.heading("score", text="Score (relative match)")
    table.column("category", width=420)
    table.column("score", width=200, anchor="e")
    table.pack(padx=20, pady=6)

    status = tk.StringVar()
    ttk.Label(root, textvariable=status, wraplength=880).pack(pady=6)
    ttk.Label(
        root,
        text="Zero-shot pretrained CLIP model. Scores are relative matches, not measured accuracy.",
    ).pack(pady=(2, 8))

    messages: "queue.Queue[tuple[str, object]]" = queue.Queue()
    detector: list = []  # holds the loaded detector once available

    missing = dz.check_dependencies()
    if missing:
        status.set(dz.dependency_message(missing))
    elif dz.model_is_cached():
        status.set("Choose an image to analyse. The model is cached locally.")
    else:
        status.set(dz.not_cached_message() + "\nIt downloads automatically when you analyse your first image.")

    def worker(path: str) -> None:
        try:
            image = dz.load_image(path)
            if not detector:
                messages.put(("status", "Loading model (first use downloads it - this can take several minutes)..."))
                detector.append(dz.ZeroShotDisasterDetector())
            messages.put(("result", detector[0].predict_scores_image(image)))
        except (ValueError, dz.ModelUnavailableError) as exc:
            messages.put(("error", str(exc)))
        except Exception as exc:  # keep the GUI alive on unexpected failures
            messages.put(("error", f"Unexpected error: {exc}"))

    def choose() -> None:
        if dz.check_dependencies():
            status.set(dz.dependency_message(dz.check_dependencies()))
            return
        path = filedialog.askopenfilename(
            title="Choose a disaster or normal image",
            filetypes=[("Images", "*.jpg *.jpeg *.png *.webp *.bmp"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            from PIL import ImageTk

            thumb = dz.load_image(path)
            thumb.thumbnail((860, 380))
            preview.image = ImageTk.PhotoImage(thumb)
            preview.configure(image=preview.image)
        except ValueError as exc:
            status.set(str(exc))
            return
        button.configure(state="disabled")
        result.set("Analysing image...")
        table.delete(*table.get_children())
        threading.Thread(target=worker, args=(path,), daemon=True).start()

    button = ttk.Button(root, text="Choose image and analyse", command=choose)
    button.pack(pady=10)

    def poll() -> None:
        try:
            kind, data = messages.get_nowait()
        except queue.Empty:
            root.after(100, poll)
            return
        if kind == "status":
            status.set(str(data))
        elif kind == "error":
            button.configure(state="normal")
            result.set("Analysis unavailable")
            status.set(str(data))
        else:
            button.configure(state="normal")
            ranked = dz.rank_scores(data)  # type: ignore[arg-type]
            label, score = ranked[0]
            prefix = "UNCERTAIN - closest match: " if dz.is_uncertain(ranked) else "Possible category: "
            result.set(f"{prefix}{label.upper()} ({score:.0%}) - AI estimate")
            for name, value in ranked:
                table.insert("", "end", values=(name, f"{value:.1%}"))
            status.set("Analysis complete. " + dz.AI_DISCLAIMER)
        root.after(100, poll)

    poll()
    root.mainloop()


if __name__ == "__main__":
    main()
