package com.yueyantech.oio.chatselectabletext

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.Build
import android.text.TextPaint
import android.text.SpannableString
import android.text.Selection
import android.text.Spannable
import android.text.Spanned
import android.widget.TextView
import android.text.style.ForegroundColorSpan
import android.text.style.CharacterStyle
import android.text.style.UpdateAppearance
import android.util.TypedValue
import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.Window
import androidx.appcompat.widget.AppCompatTextView
import androidx.appcompat.view.WindowCallbackWrapper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.facebook.react.uimanager.PixelUtil
import org.json.JSONArray
import java.lang.ref.WeakReference

class ChatSelectableTextView(context: Context) : AppCompatTextView(context) {
  companion object {
    private const val TAG = "ChatSelectableText"
    private const val CUSTOM_MENU_ITEM_ID_BASE = 0x4F490000
    private var activeSelectionView: WeakReference<ChatSelectableTextView>? = null
  }

  private class BlankMaskSpan : CharacterStyle(), UpdateAppearance {
    override fun updateDrawState(textPaint: TextPaint) {
      textPaint.color = Color.TRANSPARENT
    }
  }

  /**
   * Android positions selection handles at the 3/4 (start) and 1/4 (end)
   * points of their drawable. The platform's round API 36 handles draw the
   * circle away from that hotspot, which makes the handles look detached from
   * the selected glyphs. Keep the native selection/drag behavior, but place
   * the visible circle directly on the platform hotspot.
   */
  private class CenteredSelectionHandleDrawable(
    private val density: Float,
    private val startHandle: Boolean,
    color: Int,
  ) : Drawable() {
    private val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      this.color = color
    }
    private val intrinsicWidthPx = (24f * density).toInt().coerceAtLeast(1)
    private val intrinsicHeightPx = (18f * density).toInt().coerceAtLeast(1)
    private val radiusPx = 6f * density
    private val stemWidthPx = 2f * density
    private val stemHeightPx = 5f * density

    override fun draw(canvas: Canvas) {
      val hotspotX = bounds.left + bounds.width() * (if (startHandle) 0.75f else 0.25f)
      val top = bounds.top.toFloat()
      canvas.drawRect(
        hotspotX - stemWidthPx / 2f,
        top,
        hotspotX + stemWidthPx / 2f,
        top + stemHeightPx,
        handlePaint,
      )
      canvas.drawCircle(hotspotX, top + stemHeightPx + radiusPx, radiusPx, handlePaint)
    }

    override fun setAlpha(alpha: Int) {
      handlePaint.alpha = alpha
      invalidateSelf()
    }

    @Suppress("DEPRECATION")
    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {
      handlePaint.colorFilter = colorFilter
      invalidateSelf()
    }

    @Deprecated("Deprecated in the Android Drawable API")
    override fun getOpacity(): Int = android.graphics.PixelFormat.TRANSLUCENT

    override fun getIntrinsicWidth(): Int = intrinsicWidthPx
    override fun getIntrinsicHeight(): Int = intrinsicHeightPx
  }

  private var rawText: String = ""
  private var highlightRangesJson: String = "[]"
  private var blankRangesJson: String = "[]"
  private var correctRangesJson: String = "[]"
  private var answersVisible: Boolean = false
  private var visualsHidden: Boolean = false
  private var menuOptions: List<String> = emptyList()
  private var currentTextColor: Int = Color.parseColor("#111111")
  private var currentActionMode: ActionMode? = null
  private var pendingRange: Range? = null
  private var pendingDownX: Float = 0f
  private var pendingDownY: Float = 0f
  private var pendingSelectionRelease: Boolean = false
  private var pendingTextApply: Boolean = false
  private var textApplyRequested: Boolean = false
  private var rangeLongPressed: Boolean = false
  private var selectionMode: String = "range"
  private var observedWindow: Window? = null
  private var previousWindowCallback: Window.Callback? = null
  private var outsideTouchCallback: Window.Callback? = null
  private val touchSlop: Int = ViewConfiguration.get(context).scaledTouchSlop
  private val rangeLongPressRunnable = Runnable {
    val range = pendingRange ?: return@Runnable
    rangeLongPressed = true
    parent?.requestDisallowInterceptTouchEvent(false)
    emitClozeRange("topClozeRangeLongPress", range)
  }

  init {
    includeFontPadding = false
    setTextColor(currentTextColor)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
    setLineSpacing(0f, 1f)
    setTextIsSelectable(true)
    isClickable = true
    isLongClickable = true
    isFocusable = true
    isFocusableInTouchMode = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val accent = TypedValue().let { value ->
        if (context.theme.resolveAttribute(android.R.attr.colorAccent, value, true)) value.data
        else Color.parseColor("#009688")
      }
      setTextSelectHandleLeft(CenteredSelectionHandleDrawable(resources.displayMetrics.density, true, accent))
      setTextSelectHandleRight(CenteredSelectionHandleDrawable(resources.displayMetrics.density, false, accent))
    }
    setupSelectionMenu()
  }

  fun setRawText(value: String) {
    rawText = value
    requestApplyText()
  }

  fun setHighlightRangesJson(value: String) {
    highlightRangesJson = value
    requestApplyText()
  }

  fun setBlankRangesJson(value: String) {
    blankRangesJson = value
    requestApplyText()
  }

  fun setCorrectRangesJson(value: String) {
    correctRangesJson = value
    requestApplyText()
  }

  fun setAnswersVisible(value: Boolean) {
    answersVisible = value
    requestApplyText()
  }

  fun setVisualsHidden(value: Boolean) {
    visualsHidden = value
    requestApplyText()
    invalidate()
  }

  fun setMenuOptions(value: List<String>) {
    menuOptions = value
    currentActionMode?.invalidate()
  }

  fun setSelectionMode(value: String?) {
    selectionMode = if (value == "all") "all" else "range"
  }

  fun setTextColorValue(value: String) {
    currentTextColor = parseColor(value, Color.parseColor("#111111"))
    requestApplyText()
  }

  fun setFontSizeSp(value: Float) {
    setTextSize(TypedValue.COMPLEX_UNIT_SP, value)
    requestApplyText()
  }

  fun setLineHeightSp(value: Float) {
    val fontHeight = paint.fontMetrics.descent - paint.fontMetrics.ascent
    val desiredPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, value, resources.displayMetrics)
    setLineSpacing((desiredPx - fontHeight).coerceAtLeast(0f), 1f)
    requestApplyText()
  }

  fun setFontWeight(value: String?) {
    typeface = when (value) {
      "bold", "700", "800", "900" -> Typeface.DEFAULT_BOLD
      else -> Typeface.DEFAULT
    }
    requestApplyText()
  }

  fun clearSelectionState() {
    removeCallbacks(rangeLongPressRunnable)
    cancelLongPress()
    pendingRange = null
    rangeLongPressed = false
    ensureSpannableTextBuffer()
    parent?.requestDisallowInterceptTouchEvent(false)
    val mode = currentActionMode
    if (mode != null) {
      mode.finish()
    } else {
      stopObservingOutsideSelectionTaps()
    }
    scheduleSelectionRelease()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(rangeLongPressRunnable)
    cancelLongPress()
    pendingRange = null
    rangeLongPressed = false
    parent?.requestDisallowInterceptTouchEvent(false)
    currentActionMode?.finish()
    currentActionMode = null
    stopObservingOutsideSelectionTaps()
    super.onDetachedFromWindow()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val handledRangeTouch = handleClozeRangeTouch(event)
    if (handledRangeTouch) return true

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        pendingDownX = event.x
        pendingDownY = event.y
        emitTextInteractionStart()
        ensureSpannableTextBuffer()
        requestFocus()
        parent?.requestDisallowInterceptTouchEvent(true)
        return super.onTouchEvent(event)
      }
      MotionEvent.ACTION_MOVE -> {
        val movedX = kotlin.math.abs(event.x - pendingDownX)
        val movedY = kotlin.math.abs(event.y - pendingDownY)
        if (movedX > touchSlop || movedY > touchSlop) {
          parent?.requestDisallowInterceptTouchEvent(currentActionMode != null || hasActiveTextSelection())
        }
        return super.onTouchEvent(event)
      }
      MotionEvent.ACTION_UP -> {
        val handled = super.onTouchEvent(event)
        parent?.requestDisallowInterceptTouchEvent(false)
        return handled
      }
      MotionEvent.ACTION_CANCEL -> {
        parent?.requestDisallowInterceptTouchEvent(false)
        val handled = super.onTouchEvent(event)
        return handled
      }
    }
    return super.onTouchEvent(event)
  }

  override fun performLongClick(): Boolean {
    ensureSpannableTextBuffer()
    if (!isLongPressWithinTextBounds()) {
      parent?.requestDisallowInterceptTouchEvent(false)
      releaseSelectableIfIdle()
      return false
    }
    return try {
      val handled = super.performLongClick()
      if (handled && selectionMode == "all" && rawText.isNotEmpty()) {
        val spannable = ensureSpannableTextBuffer()
        Selection.setSelection(spannable, 0, spannable.length)
        currentActionMode?.invalidate()
      }
      handled
    } catch (error: RuntimeException) {
      Log.e(TAG, "performLongClick failed; releasing selectable state", error)
      releaseSelectableIfIdle()
      false
    }
  }

  private fun isLongPressWithinTextBounds(): Boolean {
    val textLayout = layout ?: return false
    if (rawText.isEmpty() || textLayout.lineCount == 0) return false

    val contentX = pendingDownX - totalPaddingLeft + scrollX
    val contentY = pendingDownY - totalPaddingTop + scrollY
    if (contentY < 0f || contentY >= textLayout.height.toFloat()) return false

    val line = textLayout.getLineForVertical(contentY.toInt())
    val baseline = textLayout.getLineBaseline(line).toFloat()
    val fontMetrics = paint.fontMetrics
    val tolerance = resources.displayMetrics.density * 2f
    val glyphTop = baseline + fontMetrics.ascent - tolerance
    val glyphBottom = baseline + fontMetrics.descent + tolerance
    if (contentY < glyphTop || contentY > glyphBottom) return false

    val lineLeft = minOf(textLayout.getLineLeft(line), textLayout.getLineRight(line)) - tolerance
    val lineRight = maxOf(textLayout.getLineLeft(line), textLayout.getLineRight(line)) + tolerance
    return contentX in lineLeft..lineRight
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyTextIfReady()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    applyTextIfReady()
  }

  override fun onDraw(canvas: Canvas) {
    val textLayout = layout ?: return
    val textLength = text?.length ?: return
    if (textLength == 0) {
      super.onDraw(canvas)
      return
    }
    if (visualsHidden) {
      super.onDraw(canvas)
      return
    }
    val density = resources.displayMetrics.density
    val correctRanges = parseRanges(correctRangesJson)
    val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    parseRanges(highlightRangesJson).forEach { range ->
      val isCorrect = correctRanges.any { correct -> correct.start == range.start && correct.end == range.end }
      backgroundPaint.color = Color.parseColor(if (isCorrect) "#DDEFE2" else "#FFF0B8")
      drawRangeLines(textLayout, textLength, range) { left, top, right, bottom ->
        canvas.drawRect(left, top, right, bottom, backgroundPaint)
      }
    }

    super.onDraw(canvas)
    val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#8C6D1F")
      strokeWidth = 1.5f * density
      style = Paint.Style.STROKE
    }
    parseRanges(blankRangesJson).forEach { range ->
      drawRangeLines(textLayout, textLength, range) { left, _, right, bottom ->
        canvas.drawLine(left, bottom + density, right, bottom + density, linePaint)
      }
    }
  }

  private inline fun drawRangeLines(
    textLayout: android.text.Layout,
    textLength: Int,
    range: Range,
    draw: (left: Float, top: Float, right: Float, bottom: Float) -> Unit,
  ) {
    val safeStart = range.start.coerceIn(0, textLength)
    val safeEnd = range.end.coerceIn(safeStart, textLength)
    if (safeStart >= safeEnd) return
    val firstLine = textLayout.getLineForOffset(safeStart)
    val lastLine = textLayout.getLineForOffset((safeEnd - 1).coerceAtLeast(safeStart))
    for (line in firstLine..lastLine) {
      val lineStart = maxOf(safeStart, textLayout.getLineStart(line))
      val lineEnd = minOf(safeEnd, textLayout.getLineEnd(line))
      if (lineStart >= lineEnd) continue
      val startX = compoundPaddingLeft + textLayout.getPrimaryHorizontal(lineStart)
      val endX = compoundPaddingLeft + textLayout.getPrimaryHorizontal(lineEnd)
      // Android can report a shorter box for the final line of a paragraph.
      // Derive a fixed-height highlight from the text baseline instead so
      // mastered/unfinished blanks and normal/fill mode share the same visual
      // height regardless of which line the blank lands on. This mirrors the
      // fixed fontSize + 2pt rectangle used by the iOS implementation.
      val fontMetrics = paint.fontMetrics
      val textCenter = extendedPaddingTop - scrollY + textLayout.getLineBaseline(line) +
        (fontMetrics.ascent + fontMetrics.descent) / 2f
      val fixedHeight = minOf(
        textLayout.getLineBottom(line) - textLayout.getLineTop(line).toFloat(),
        paint.textSize + 2f * resources.displayMetrics.density,
      )
      val top = textCenter - fixedHeight / 2f
      val bottom = top + fixedHeight
      draw(minOf(startX, endX), top, maxOf(startX, endX), bottom)
    }
  }

  private fun requestApplyText() {
    textApplyRequested = true
    if (pendingTextApply) return
    pendingTextApply = true
    post {
      pendingTextApply = false
      applyTextIfReady()
    }
  }

  private fun applyTextIfReady() {
    if (!textApplyRequested) return
    if (!isAttachedToWindow || layoutParams == null) return
    textApplyRequested = false
    applyText()
  }

  private fun applyText() {
    val blankRanges = parseRanges(blankRangesJson)
    val visibleText = buildVisibleText(rawText, blankRanges, answersVisible)
    val spannable = SpannableString(visibleText)

    if (visibleText.isNotEmpty()) {
      spannable.setSpan(ForegroundColorSpan(if (visualsHidden) Color.TRANSPARENT else currentTextColor), 0, visibleText.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    if (!visualsHidden) parseRanges(highlightRangesJson).forEach { range ->
      applyRangeSpan(spannable, range.start, range.end, visibleText.length, ForegroundColorSpan(Color.parseColor("#3D3420")))
    }

    // Apply the blank span last so its underline stays visible over both the
    // yellow and mastered-green backgrounds.
    if (!answersVisible) {
      blankRanges.forEach { range ->
        applyRangeSpan(spannable, range.start, range.end, visibleText.length, BlankMaskSpan())
      }
    }

    setText(spannable, TextView.BufferType.SPANNABLE)
  }

  private fun ensureSpannableTextBuffer(): Spannable {
    val current = text
    if (current is Spannable) return current
    val spannable = SpannableString(current ?: "")
    setText(spannable, TextView.BufferType.SPANNABLE)
    return spannable
  }

  private fun hasActiveTextSelection(): Boolean {
    val start = selectionStart
    val end = selectionEnd
    return start >= 0 && end >= 0 && start != end
  }

  private fun scheduleSelectionRelease() {
    if (pendingSelectionRelease) return
    pendingSelectionRelease = true
    post {
      pendingSelectionRelease = false
      if (currentActionMode != null) return@post
      val spannable = ensureSpannableTextBuffer()
      Selection.removeSelection(spannable)
      ensureSpannableTextBuffer()
      clearFocus()
    }
  }

  private fun releaseSelectableIfIdle() {
    post {
      if (currentActionMode != null || hasActiveTextSelection()) return@post
      ensureSpannableTextBuffer()
      clearFocus()
    }
  }

  private fun setupSelectionMenu() {
    customSelectionActionModeCallback = object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
        ensureSpannableTextBuffer()
        currentActionMode = mode
        populateSelectionMenu(menu)
        emitSelectionStart()
        startObservingOutsideSelectionTaps()
        return true
      }

      override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean {
        populateSelectionMenu(menu)
        return true
      }

      override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean {
        val optionIndex = (item?.itemId ?: return false) - CUSTOM_MENU_ITEM_ID_BASE
        val chosenOption = menuOptions.getOrNull(optionIndex) ?: return false
        val selectedStart = selectionStart.coerceAtMost(selectionEnd).coerceIn(0, rawText.length)
        val selectedEnd = selectionStart.coerceAtLeast(selectionEnd).coerceIn(selectedStart, rawText.length)
        val selectedText = rawText.substring(selectedStart, selectedEnd)

        emitSelection(chosenOption, selectedText, selectedStart, selectedEnd)
        mode?.finish()
        return true
      }

      override fun onDestroyActionMode(mode: ActionMode?) {
        if (currentActionMode === mode) {
          currentActionMode = null
        }
        stopObservingOutsideSelectionTaps()
        emitSelectionEnd()
        scheduleSelectionRelease()
      }

      override fun onGetContentRect(mode: ActionMode?, view: android.view.View?, outRect: Rect?) {
        if (outRect == null) return
        val selectedStart = selectionStart.coerceAtMost(selectionEnd)
        val selectedEnd = selectionStart.coerceAtLeast(selectionEnd)
        val selectionRect = selectionRectForRangeLocal(selectedStart, selectedEnd)
        if (selectionRect.isEmpty) {
          super.onGetContentRect(mode, view, outRect)
          return
        }
        selectionRect.roundOut(outRect)
      }
    }
  }

  private fun populateSelectionMenu(menu: Menu?) {
    if (menu == null || menuOptions.isEmpty()) return
    menu.clear()
    menuOptions.forEachIndexed { index, option ->
      menu
        .add(Menu.NONE, CUSTOM_MENU_ITEM_ID_BASE + index, index, option)
        .setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS or MenuItem.SHOW_AS_ACTION_WITH_TEXT)
    }
  }

  private fun startObservingOutsideSelectionTaps() {
    val previousActive = activeSelectionView?.get()
    if (previousActive !== null && previousActive !== this) previousActive.clearSelectionState()
    activeSelectionView = WeakReference(this)
    if (outsideTouchCallback != null) return
    val reactContext = context as? ReactContext ?: return
    val window = reactContext.currentActivity?.window ?: return
    val previousCallback = window.callback ?: return
    val callback = object : WindowCallbackWrapper(previousCallback) {
      override fun dispatchTouchEvent(event: MotionEvent?): Boolean {
        if (event?.actionMasked == MotionEvent.ACTION_DOWN && currentActionMode != null && !isTouchInsideSelection(event)) {
          post { if (currentActionMode != null) clearSelectionState() }
        }
        return super.dispatchTouchEvent(event)
      }
    }
    observedWindow = window
    previousWindowCallback = previousCallback
    outsideTouchCallback = callback
    window.callback = callback
  }

  private fun stopObservingOutsideSelectionTaps() {
    val window = observedWindow
    val callback = outsideTouchCallback
    if (window != null && callback != null && window.callback === callback) {
      previousWindowCallback?.let { window.callback = it }
    }
    observedWindow = null
    previousWindowCallback = null
    outsideTouchCallback = null
    if (activeSelectionView?.get() === this) activeSelectionView = null
  }

  private fun isTouchInsideSelection(event: MotionEvent): Boolean {
    val selectedStart = selectionStart.coerceAtMost(selectionEnd)
    val selectedEnd = selectionStart.coerceAtLeast(selectionEnd)
    val rect = selectionRectForRange(selectedStart, selectedEnd)
    if (rect.isEmpty) return false
    val padding = 10f * resources.displayMetrics.density
    rect.inset(-padding, -padding)
    return rect.contains(event.rawX, event.rawY)
  }

  private fun handleClozeRangeTouch(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        val range = findRangeAt(event.x, event.y) ?: return false
        pendingRange = range
        pendingDownX = event.x
        pendingDownY = event.y
        rangeLongPressed = false
        parent?.requestDisallowInterceptTouchEvent(true)
        postDelayed(rangeLongPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (pendingRange == null) return false
        val movedX = kotlin.math.abs(event.x - pendingDownX)
        val movedY = kotlin.math.abs(event.y - pendingDownY)
        if (movedX > touchSlop || movedY > touchSlop) {
          cancelPendingRangeTouch()
          parent?.requestDisallowInterceptTouchEvent(false)
          return false
        }
        return true
      }
      MotionEvent.ACTION_UP -> {
        val range = pendingRange ?: return false
        removeCallbacks(rangeLongPressRunnable)
        pendingRange = null
        parent?.requestDisallowInterceptTouchEvent(false)
        if (!rangeLongPressed) {
          emitClozeRange("topClozeRangePress", range)
        }
        rangeLongPressed = false
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        if (pendingRange == null) return false
        cancelPendingRangeTouch()
        parent?.requestDisallowInterceptTouchEvent(false)
        return true
      }
    }
    return false
  }

  private fun cancelPendingRangeTouch() {
    removeCallbacks(rangeLongPressRunnable)
    pendingRange = null
    rangeLongPressed = false
  }

  private fun emitSelectionStart() {
    val reactContext = context as? ReactContext ?: return
    val event = Arguments.createMap()
    reactContext
      .getJSModule(RCTEventEmitter::class.java)
      .receiveEvent(id, "topSelectionStart", event)
  }

  private fun emitSelectionEnd() {
    val reactContext = context as? ReactContext ?: return
    val event = Arguments.createMap()
    reactContext
      .getJSModule(RCTEventEmitter::class.java)
      .receiveEvent(id, "topSelectionEnd", event)
  }

  private fun emitTextInteractionStart() {
    val reactContext = context as? ReactContext ?: return
    val event = Arguments.createMap()
    reactContext
      .getJSModule(RCTEventEmitter::class.java)
      .receiveEvent(id, "topTextInteractionStart", event)
  }

  private fun findRangeAt(x: Float, y: Float): Range? {
    if (rawText.isEmpty()) return null
    val offset = try {
      getOffsetForPosition(x, y)
    } catch (_: Exception) {
      return null
    }
    return parseRanges(highlightRangesJson).firstOrNull { range ->
      offset >= range.start && offset < range.end
    }
  }

  private fun emitSelection(chosenOption: String, selectedText: String, selectedStart: Int, selectedEnd: Int) {
    val reactContext = context as? ReactContext ?: return
    val rect = selectionRectForRange(selectedStart, selectedEnd)
    val event = Arguments.createMap().apply {
      putString("chosenOption", chosenOption)
      putString("highlightedText", selectedText)
      putInt("selectionStart", selectedStart)
      putInt("selectionEnd", selectedEnd)
      putMap("selectionRect", Arguments.createMap().apply {
        putDouble("pageX", PixelUtil.toDIPFromPixel(rect.left).toDouble())
        putDouble("pageY", PixelUtil.toDIPFromPixel(rect.top).toDouble())
        putDouble("width", PixelUtil.toDIPFromPixel(rect.width()).toDouble())
        putDouble("height", PixelUtil.toDIPFromPixel(rect.height()).toDouble())
      })
    }
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, "topSelection", event)
  }

  private fun selectionRectForRange(start: Int, end: Int): RectF {
    val result = selectionRectForRangeLocal(start, end)
    if (result.isEmpty) return result
    val location = IntArray(2)
    getLocationOnScreen(location)
    result.offset(location[0].toFloat(), location[1].toFloat())
    return result
  }

  private fun selectionRectForRangeLocal(start: Int, end: Int): RectF {
    val result = RectF()
    val currentText = text ?: return result
    if (currentText.isEmpty() || layout == null) return result
    val safeStart = start.coerceIn(0, currentText.length)
    val safeEnd = end.coerceIn(safeStart, currentText.length)
    if (safeStart >= safeEnd) return result
    val startLine = layout.getLineForOffset(safeStart)
    val endLine = layout.getLineForOffset((safeEnd - 1).coerceAtLeast(safeStart))
    for (line in startLine..endLine) {
      val lineStart = layout.getLineStart(line)
      val lineEnd = layout.getLineVisibleEnd(line).coerceAtLeast(lineStart)
      val segmentStart = maxOf(safeStart, lineStart)
      val segmentEnd = minOf(safeEnd, lineEnd)
      if (segmentStart >= segmentEnd) continue
      val left = layout.getPrimaryHorizontal(segmentStart) + totalPaddingLeft - scrollX
      val right = layout.getPrimaryHorizontal(segmentEnd) + totalPaddingLeft - scrollX
      val top = layout.getLineTop(line).toFloat() + totalPaddingTop - scrollY
      val bottom = layout.getLineBottom(line).toFloat() + totalPaddingTop - scrollY
      val rect = RectF(minOf(left, right), top, maxOf(left, right), bottom)
      if (result.isEmpty) {
        result.set(rect)
      } else {
        result.union(rect)
      }
    }
    return result
  }

  private fun emitClozeRange(eventName: String, range: Range) {
    val reactContext = context as? ReactContext ?: return
    val rect = selectionRectForRange(range.start, range.end)
    val event = Arguments.createMap().apply {
      putInt("groupIndex", range.groupIndex)
      putMap("selectionRect", Arguments.createMap().apply {
        putDouble("pageX", PixelUtil.toDIPFromPixel(rect.left).toDouble())
        putDouble("pageY", PixelUtil.toDIPFromPixel(rect.top).toDouble())
        putDouble("width", PixelUtil.toDIPFromPixel(rect.width()).toDouble())
        putDouble("height", PixelUtil.toDIPFromPixel(rect.height()).toDouble())
      })
    }
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, eventName, event)
  }

  private fun buildVisibleText(text: String, blankRanges: List<Range>, answersVisible: Boolean): String {
    return text
  }

  private fun applyRangeSpan(spannable: SpannableString, start: Int, end: Int, length: Int, span: Any) {
    val safeStart = start.coerceIn(0, length)
    val safeEnd = end.coerceIn(safeStart, length)
    if (safeStart < safeEnd) {
      spannable.setSpan(span, safeStart, safeEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
  }

  private fun parseRanges(json: String): List<Range> {
    return try {
      val array = JSONArray(json)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        val start = item.optInt("start", 0)
        val end = item.optInt("end", start)
        val groupIndex = item.optInt("groupIndex", index)
        if (start < end) Range(start, end, groupIndex) else null
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun parseColor(value: String, fallback: Int): Int {
    return try {
      Color.parseColor(value)
    } catch (_: Exception) {
      fallback
    }
  }

  private data class Range(val start: Int, val end: Int, val groupIndex: Int)
}
