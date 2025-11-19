package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"strconv"
	"strings"

	"dev.danielrb/auto-imm/api/internal/request"
	"dev.danielrb/auto-imm/api/internal/response"
	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/gen2brain/go-fitz"
	"github.com/otiai10/gosseract/v2"
)

func (app *application) status(w http.ResponseWriter, r *http.Request) {
	data := map[string]string{
		"Status": "OK",
	}

	err := response.JSON(w, http.StatusOK, data)
	if err != nil {
		app.serverError(w, r, err)
	}
}

func (app *application) restricted(w http.ResponseWriter, r *http.Request) {
	data := map[string]string{
		"Message": "This is a restricted handler",
	}

	err := response.JSON(w, http.StatusOK, data)
	if err != nil {
		app.serverError(w, r, err)
	}
}

// Helper function to extract text from a single image using Claude
func (app *application) extractTextFromImageData(ctx context.Context, client anthropic.Client, base64Image string, mediaType string) (string, error) {
	prompt := "Extract all text from this image. Translate to English and format the text in whatever format makes the most sense. Assume the image is a personal document like a passport."
	message, err := client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     "claude-sonnet-4-5",
		MaxTokens: int64(app.config.anthropic.maxTokens),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(prompt),
				anthropic.NewImageBlockBase64(mediaType, base64Image),
			),
		},
	})

	if err != nil {
		return "", err
	}

	// Extract text from response
	var extractedText string
	for _, block := range message.Content {
		if block.Type == "text" {
			extractedText += block.Text
		}
	}

	return extractedText, nil
}

// Helper function to process PDF by converting pages to images
func (app *application) processPDF(ctx context.Context, client anthropic.Client, pdfData []byte) (string, error) {
	// Open PDF document
	doc, err := fitz.NewFromMemory(pdfData)
	if err != nil {
		return "", fmt.Errorf("failed to open PDF: %w", err)
	}
	defer doc.Close()

	numPages := doc.NumPage()
	var allText strings.Builder

	// Process each page
	for pageNum := 0; pageNum < numPages; pageNum++ {
		app.logger.Info("Parsing page num")
		app.logger.Info(strconv.Itoa(pageNum))
		// Render page to image at 150 DPI (sufficient for OCR, keeps file size under 5MB limit)
		img, err := doc.ImageDPI(pageNum, 150.0)
		if err != nil {
			return "", fmt.Errorf("failed to render page %d: %w", pageNum+1, err)
		}

		// Convert image to JPEG bytes with 85% quality (good balance of quality and size)
		var buf bytes.Buffer
		err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85})
		if err != nil {
			return "", fmt.Errorf("failed to encode page %d as JPEG: %w", pageNum+1, err)
		}

		// Base64 encode the JPEG
		base64Image := base64.StdEncoding.EncodeToString(buf.Bytes())

		// Extract text from this page
		pageText, err := app.extractTextFromImageData(ctx, client, base64Image, "image/jpeg")
		if err != nil {
			return "", fmt.Errorf("failed to extract text from page %d: %w", pageNum+1, err)
		}

		// Add page separator and text
		if numPages > 1 {
			allText.WriteString(fmt.Sprintf("=== Page %d ===\n", pageNum+1))
		}
		allText.WriteString(pageText)
		if pageNum < numPages-1 {
			allText.WriteString("\n\n")
		}
	}

	return allText.String(), nil
}

func (app *application) extractTextFromImage(w http.ResponseWriter, r *http.Request) {
	// Check if Anthropic API key is configured
	if app.config.anthropic.apiKey == "" {
		app.serverError(w, r, errors.New("Anthropic API key not configured"))
		return
	}

	// Parse multipart form (32MB limit)
	err := r.ParseMultipartForm(32 << 20)
	if err != nil {
		app.badRequest(w, r, err)
		return
	}

	// Get uploaded file
	file, header, err := r.FormFile("file")
	if err != nil {
		app.badRequest(w, r, errors.New("file is required"))
		return
	}
	defer file.Close()

	// Validate file size (20MB limit)
	const maxFileSize = 20 * 1024 * 1024 // 20MB
	if header.Size > maxFileSize {
		app.badRequest(w, r, errors.New("file must be less than 20MB"))
		return
	}

	// Read file content
	fileData, err := io.ReadAll(file)
	if err != nil {
		app.serverError(w, r, err)
		return
	}

	// Create Anthropic client
	client := anthropic.NewClient(
		option.WithAPIKey(app.config.anthropic.apiKey),
	)
	ctx := context.Background()

	var extractedText string

	// Check if file is a PDF
	isPDF := strings.HasSuffix(strings.ToLower(header.Filename), ".pdf")

	if isPDF {
		app.logger.Info("Process PDF by converting pages to images")
		extractedText, err = app.processPDF(ctx, client, fileData)
		if err != nil {
			app.serverError(w, r, err)
			return
		}
	} else {
		// Process as image
		// Base64 encode the image
		base64Image := base64.StdEncoding.EncodeToString(fileData)

		// Determine media type from file extension
		mediaType := "image/jpeg"
		if len(header.Filename) > 4 {
			ext := strings.ToLower(header.Filename[len(header.Filename)-4:])
			switch ext {
			case ".png":
				mediaType = "image/png"
			case ".jpg", "jpeg":
				mediaType = "image/jpeg"
			}
		}

		extractedText, err = app.extractTextFromImageData(ctx, client, base64Image, mediaType)
		if err != nil {
			app.serverError(w, r, err)
			return
		}
	}

	// Return extracted text as plain text
	// w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	// w.WriteHeader(http.StatusOK)
	// _, err = w.Write([]byte(extractedText))
	app.logger.Info("bob")
	app.logger.Info(extractedText)
	data := map[string]string{
		"text": extractedText,
	}
	err = response.JSON(w, http.StatusOK, data)
	if err != nil {
		app.logger.Error(err.Error())
	}
}

// Helper function to extract text from image using Tesseract OCR
func (app *application) processImageWithTesseract(imageData []byte) (string, error) {
	client := gosseract.NewClient()
	defer client.Close()

	// Set language to English
	client.SetLanguage("eng")

	// Set image from bytes
	if err := client.SetImageFromBytes(imageData); err != nil {
		return "", fmt.Errorf("invalid image format: %w", err)
	}

	// Extract textDashboard
	text, err := client.Text()
	if err != nil {
		return "", fmt.Errorf("OCR processing failed: %w", err)
	}

	return text, nil
}

// Helper function to process PDF using Tesseract OCR
func (app *application) processPDFWithTesseract(pdfData []byte) (string, error) {
	// Open PDF document
	doc, err := fitz.NewFromMemory(pdfData)
	if err != nil {
		return "", fmt.Errorf("failed to open PDF: %w", err)
	}
	defer doc.Close()

	numPages := doc.NumPage()
	var allText strings.Builder

	// Process each page
	for pageNum := 0; pageNum < numPages; pageNum++ {
		// Render page to image at 300 DPI (higher DPI for better OCR accuracy with Tesseract)
		img, err := doc.ImageDPI(pageNum, 300.0)
		if err != nil {
			return "", fmt.Errorf("failed to render page %d: %w", pageNum+1, err)
		}

		// Convert image to PNG bytes (Tesseract works well with PNG)
		var buf bytes.Buffer
		err = png.Encode(&buf, img)
		if err != nil {
			return "", fmt.Errorf("failed to encode page %d as PNG: %w", pageNum+1, err)
		}

		// Extract text from this page using Tesseract
		pageText, err := app.processImageWithTesseract(buf.Bytes())
		if err != nil {
			return "", fmt.Errorf("failed to OCR page %d: %w", pageNum+1, err)
		}

		// Add page separator and text
		if numPages > 1 {
			allText.WriteString(fmt.Sprintf("=== Page %d ===\n", pageNum+1))
		}
		allText.WriteString(pageText)
		if pageNum < numPages-1 {
			allText.WriteString("\n\n")
		}
	}

	return allText.String(), nil
}

// HTTP handler for Tesseract OCR endpoint
func (app *application) extractTextFromImageTesseract(w http.ResponseWriter, r *http.Request) {
	// Parse multipart form (32MB limit)
	err := r.ParseMultipartForm(32 << 20)
	if err != nil {
		app.badRequest(w, r, err)
		return
	}

	// Get uploaded file
	file, header, err := r.FormFile("file")
	if err != nil {
		app.badRequest(w, r, errors.New("file is required"))
		return
	}
	defer file.Close()

	// Validate file size (20MB limit)
	const maxFileSize = 20 * 1024 * 1024 // 20MB
	if header.Size > maxFileSize {
		app.badRequest(w, r, errors.New("file must be less than 20MB"))
		return
	}

	// Read file content
	fileData, err := io.ReadAll(file)
	if err != nil {
		app.serverError(w, r, err)
		return
	}

	var extractedText string

	// Check if file is a PDF
	isPDF := strings.HasSuffix(strings.ToLower(header.Filename), ".pdf")

	if isPDF {
		// Process PDF with Tesseract
		extractedText, err = app.processPDFWithTesseract(fileData)
		if err != nil {
			app.serverError(w, r, err)
			return
		}
	} else {
		// Process image with Tesseract
		extractedText, err = app.processImageWithTesseract(fileData)
		if err != nil {
			app.serverError(w, r, err)
			return
		}
	}

	// Return extracted text as plain text
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, err = w.Write([]byte(extractedText))
	if err != nil {
		app.logger.Error(err.Error())
	}
}

func (app *application) fillForm(w http.ResponseWriter, r *http.Request) {
	if app.config.anthropic.apiKey == "" {
		app.serverError(w, r, errors.New("Anthropic API key not configured"))
		return
	}

	// Parse request body
	var input struct {
		FormHTML              string `json:"formHTML"`
		DocumentsExtractedText string `json:"documentsExtractedText"`
	}

	err := request.DecodeJSON(w, r, &input)
	if err != nil {
		app.badRequest(w, r, err)
		return
	}

	// Validate inputs
	if input.FormHTML == "" {
		app.badRequest(w, r, errors.New("formHTML is required"))
		return
	}

	if input.DocumentsExtractedText == "" {
		app.badRequest(w, r, errors.New("documentsExtractedText is required"))
		return
	}

	// Log both parameters
	app.logger.Info("fillForm request received")
	app.logger.Info("formHTML length", "bytes", len(input.FormHTML))
	app.logger.Info("documentsExtractedText length", "bytes", len(input.DocumentsExtractedText))

	// Create Claude prompt for form filling
	prompt := fmt.Sprintf(`You are a form-filling assistant. Analyze this HTML form and extracted document text, then return a JSON mapping of form fields to values.

FORM HTML:
%s

DOCUMENT TEXT:
%s

Your task:
1. Identify all fillable form fields (inputs, selects, radio buttons) by their ID attribute
2. Match document data to appropriate fields
3. Return ONLY valid JSON in this exact format (no markdown, no code blocks):

{
  "fields": [
    {
      "fieldId": "lastName_input",
      "value": "Smith"
    },
    {
      "fieldId": "year_sltDateYear",
      "value": "1990"
    }
  ]
}

Rules:
- Use exact field IDs from the HTML id attributes
- For dates, parse and split into separate year/month/day fields
- For gender radio buttons, use the exact value attribute (01=Female, 02=Male, 03=Unknown, 04=Another)
- Only include fields where you found matching data
- Return ONLY valid JSON, no additional text or formatting`, input.FormHTML, input.DocumentsExtractedText)

	// Create Anthropic client
	client := anthropic.NewClient(
		option.WithAPIKey(app.config.anthropic.apiKey),
	)
	ctx := context.Background()

	// Call Claude API
	message, err := client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     "claude-sonnet-4-5",
		MaxTokens: int64(app.config.anthropic.maxTokens),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(prompt),
			),
		},
	})

	if err != nil {
		app.serverError(w, r, err)
		return
	}

	// Extract text from response
	var responseText string
	for _, block := range message.Content {
		if block.Type == "text" {
			responseText += block.Text
		}
	}

	app.logger.Info("Claude response received", "length", len(responseText))
	app.logger.Debug("Claude response", "text", responseText)

	// Clean up response (remove markdown code blocks if present)
	responseText = strings.TrimSpace(responseText)
	responseText = strings.TrimPrefix(responseText, "```json")
	responseText = strings.TrimPrefix(responseText, "```")
	responseText = strings.TrimSuffix(responseText, "```")
	responseText = strings.TrimSpace(responseText)

	// Parse JSON response
	var fillResponse struct {
		Fields []struct {
			FieldID string `json:"fieldId"`
			Value   string `json:"value"`
		} `json:"fields"`
	}

	err = json.Unmarshal([]byte(responseText), &fillResponse)
	if err != nil {
		app.logger.Error("Failed to parse Claude response as JSON", "error", err.Error(), "response", responseText)
		app.serverError(w, r, fmt.Errorf("failed to parse AI response: %w", err))
		return
	}

	// Return field mappings
	data := map[string]interface{}{
		"status": "success",
		"message": "Form filled successfully",
		"fields": fillResponse.Fields,
		"stats": map[string]int{
			"totalFields": len(fillResponse.Fields),
		},
	}

	err = response.JSON(w, http.StatusOK, data)
	if err != nil {
		app.serverError(w, r, err)
	}
}
