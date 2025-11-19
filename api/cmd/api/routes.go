package main

import (
	"net/http"
)

func (app *application) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", app.notFound)

	mux.HandleFunc("GET /status", app.status)

	mux.Handle("GET /restricted-basic-auth", app.requireBasicAuthentication(http.HandlerFunc(app.restricted)))

	mux.Handle("POST /api/ocr", app.requireBasicAuthentication(http.HandlerFunc(app.extractTextFromImage)))
	// mux.Handle("POST /api/ocr/tesseract", app.requireBasicAuthentication(http.HandlerFunc(app.extractTextFromImageTesseract)))

	return app.enableCORS(app.logAccess(app.recoverPanic(mux)))
}
