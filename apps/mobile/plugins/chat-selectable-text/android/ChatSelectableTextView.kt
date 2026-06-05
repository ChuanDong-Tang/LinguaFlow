package com.yueyantech.oio.chatselectabletext

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Selection
import android.text.Spannable
import android.text.Spanned
import android.widget.TextView
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.util.TypedValue
import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.appcompat.widget.AppCompatTextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter
import org.json.JSONArray

class ChatSelectableTextView(context: Context) : AppCompatTextView(context) {
  companion object {
    private const val TAG = "ChatSelectableText"
  }

  private var rawText: String = ""
  private var highlightRangesJson: String = "[]"
  private var blankRangesJson: String = "[]"
  private var correctRangesJson: String = "[]"
  private var answersVisible: Boolean = false
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
  private val touchSlop: Int = ViewConfiguration.get(context).scaledTouchSlop
  private val rangeLongPressRunnable = Runnable {
    val range = pendingRange ?: return@Runnable
    rangeLongPressed = true
    parent?.requestDisallowInterceptTouchEvent(false)
    emitClozeRange("topClozeRangeLongPress", range.groupIndex)
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

  fun setMenuOptions(value: List<String>) {
    menuOptions = value
  }

  fun setTextColorValue(value: String) {
    currentTextColor = parseColor(value, Color.parseColor("#111111"))
    requestApplyText()
  }

  fun setFontSizeSp(value: Float) {
    setTextSize(TypedValue.COMPLEX_UNIT_SP, value)
  }

  fun setLineHeightSp(value: Float) {
    post {
      val fontHeight = paint.fontMetrics.descent - paint.fontMetrics.ascent
      val desiredPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, value, resources.displayMetrics)
      setLineSpacing((desiredPx - fontHeight).coerceAtLeast(0f), 1f)
    }
  }

  fun setFontWeight(value: String?) {
    typeface = when (value) {
      "bold", "700", "800", "900" -> Typeface.DEFAULT_BOLD
      else -> Typeface.DEFAULT
    }
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
    }
    scheduleSelectionRelease()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val handledRangeTouch = handleClozeRangeTouch(event)
    if (handledRangeTouch) return true

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        pendingDownX = event.x
        pendingDownY = event.y
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
    return try {
      super.performLongClick()
    } catch (error: RuntimeException) {
      Log.e(TAG, "performLongClick failed; releasing selectable state", error)
      releaseSelectableIfIdle()
      false
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyTextIfReady()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    applyTextIfReady()
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
      spannable.setSpan(ForegroundColorSpan(currentTextColor), 0, visibleText.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    parseRanges(highlightRangesJson).forEach { range ->
      applyRangeSpan(spannable, range.start, range.end, visibleText.length, BackgroundColorSpan(Color.parseColor("#FFF0B8")))
      applyRangeSpan(spannable, range.start, range.end, visibleText.length, ForegroundColorSpan(Color.parseColor("#3D3420")))
    }

    blankRanges.forEach { range ->
      applyRangeSpan(spannable, range.start, range.end, visibleText.length, ForegroundColorSpan(Color.parseColor("#8C6D1F")))
      applyRangeSpan(spannable, range.start, range.end, visibleText.length, StyleSpan(Typeface.BOLD))
    }

    parseRanges(correctRangesJson).forEach { range ->
      applyRangeSpan(spannable, range.start, range.end, visibleText.length, ForegroundColorSpan(Color.parseColor("#6FAE78")))
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
    customSelectionActionModeCallback = object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
        ensureSpannableTextBuffer()
        currentActionMode = mode
        emitSelectionStart()
        return true
      }

      override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean {
        if (menuOptions.isEmpty()) return true
        menu?.clear()
        menuOptions.forEachIndexed { index, option ->
          menu?.add(0, index, 0, option)
        }
        return true
      }

      override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean {
        val optionIndex = item?.itemId ?: 0
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
        scheduleSelectionRelease()
      }
    }
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
          emitClozeRange("topClozeRangePress", range.groupIndex)
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
    val event = Arguments.createMap().apply {
      putString("chosenOption", chosenOption)
      putString("highlightedText", selectedText)
      putInt("selectionStart", selectedStart)
      putInt("selectionEnd", selectedEnd)
    }
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, "topSelection", event)
  }

  private fun emitClozeRange(eventName: String, groupIndex: Int) {
    val reactContext = context as? ReactContext ?: return
    val event = Arguments.createMap().apply {
      putInt("groupIndex", groupIndex)
    }
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, eventName, event)
  }

  private fun buildVisibleText(text: String, blankRanges: List<Range>, answersVisible: Boolean): String {
    if (answersVisible || blankRanges.isEmpty()) return text
    val chars = text.toCharArray()
    blankRanges.forEach { range ->
      val start = range.start.coerceIn(0, chars.size)
      val end = range.end.coerceIn(start, chars.size)
      for (index in start until end) {
        if (!chars[index].isWhitespace()) chars[index] = '_'
      }
    }
    return String(chars)
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
