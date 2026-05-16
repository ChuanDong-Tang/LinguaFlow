const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

const packageToPath = (packageName) => packageName.replace(/\./g, "/");

const selectableMessageTextView = (packageName) => `package ${packageName}

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.text.SpannableString
import android.text.Selection
import android.text.Spannable
import android.text.style.ReplacementSpan
import android.text.style.BackgroundColorSpan
import android.view.GestureDetector
import android.view.ActionMode
import android.view.MotionEvent
import android.view.Menu
import android.view.MenuItem
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import kotlin.math.max
import kotlin.math.min

class SelectableMessageTextView(context: Context) : TextView(context) {
  data class HighlightRange(val start: Int, val end: Int, val groupIndex: Int)
  data class BlankRange(val start: Int, val end: Int)

  private var lastStart = -1
  private var lastEnd = -1
  private var displayText = ""
  private var highlightRanges: List<HighlightRange> = emptyList()
  private var blankRanges: List<BlankRange> = emptyList()
  private val highlightColor = Color.rgb(255, 242, 184)
  private val gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onSingleTapUp(e: MotionEvent): Boolean {
      val range = findRangeAt(e.x, e.y) ?: return false
      emitClozeRangeEvent("topClozeRangePress", range)
      return true
    }

    override fun onLongPress(e: MotionEvent) {
      val range = findRangeAt(e.x, e.y) ?: return
      emitClozeRangeEvent("topClozeRangeLongPress", range)
    }
  })

  init {
    setTextIsSelectable(true)
    setTextColor(Color.rgb(17, 17, 17))
    textSize = 17f
    includeFontPadding = true
    customSelectionActionModeCallback = object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode?, menu: Menu?) = true
      override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?) = false
      override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?) = false
      override fun onDestroyActionMode(mode: ActionMode?) = Unit
    }
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    if (selStart < 0 || selEnd < 0) return
    if (selStart == lastStart && selEnd == lastEnd) return
    lastStart = selStart
    lastEnd = selEnd
    if (selStart == selEnd) {
      emitEmptySelection()
      return
    }
    emitSelection(selStart, selEnd)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (gestureDetector.onTouchEvent(event)) return true
    return super.onTouchEvent(event)
  }

  fun setDisplayText(value: String) {
    displayText = value
    applyTextAndHighlights()
  }

  fun setHighlightRanges(value: List<HighlightRange>) {
    highlightRanges = value
    applyTextAndHighlights()
  }

  fun setBlankRanges(value: List<BlankRange>) {
    blankRanges = value
    applyTextAndHighlights()
  }

  fun clearNativeSelection() {
    val current = text
    if (current is Spannable) {
      Selection.removeSelection(current)
    }
    lastStart = -1
    lastEnd = -1
    emitEmptySelection()
  }

  private fun applyTextAndHighlights() {
    val spannable = SpannableString(displayText)
    for (range in highlightRanges) {
      val start = max(0, min(range.start, displayText.length))
      val end = max(start, min(range.end, displayText.length))
      if (start < end) {
        spannable.setSpan(BackgroundColorSpan(highlightColor), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }
    for (range in blankRanges) {
      val start = max(0, min(range.start, displayText.length))
      val end = max(start, min(range.end, displayText.length))
      if (start < end) {
        spannable.setSpan(BlankTokenSpan(), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }
    text = spannable
  }

  private fun emitSelection(rawStart: Int, rawEnd: Int) {
    val value = text?.toString() ?: return
    val start = max(0, min(rawStart, rawEnd))
    val end = min(value.length, max(rawStart, rawEnd))
    if (start >= end) return

    val coords = calculateEndCoordinates(end)
    val payload = Arguments.createMap().apply {
      putInt("start", start)
      putInt("end", end)
      putString("selectedText", value.substring(start, end))
      putDouble("endX", coords.first.toDouble())
      putDouble("endY", coords.second.toDouble())
      putBoolean("isBackward", rawStart > rawEnd)
    }
    emitEvent("topSelectionChange", payload)
  }

  private fun emitEmptySelection() {
    val payload = Arguments.createMap().apply {
      putInt("start", 0)
      putInt("end", 0)
      putString("selectedText", "")
      putDouble("endX", 0.0)
      putDouble("endY", 0.0)
      putBoolean("isBackward", false)
    }
    emitEvent("topSelectionChange", payload)
  }

  private fun emitClozeRangeEvent(eventName: String, range: HighlightRange) {
    val payload = Arguments.createMap().apply {
      putInt("groupIndex", range.groupIndex)
      putInt("start", range.start)
      putInt("end", range.end)
    }
    emitEvent(eventName, payload)
  }

  private fun emitEvent(eventName: String, payload: WritableMap) {
    val reactContext = context as? ReactContext ?: return
    val surfaceId = UIManagerHelper.getSurfaceId(reactContext)
    val eventDispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    eventDispatcher.dispatchEvent(SelectableMessageTextEvent(surfaceId, id, eventName, payload))
  }

  private fun findRangeAt(x: Float, y: Float): HighlightRange? {
    val layout = layout ?: return null
    val line = layout.getLineForVertical((y.toInt() - totalPaddingTop).coerceAtLeast(0))
    val offset = layout.getOffsetForHorizontal(line, x - totalPaddingLeft)
    return highlightRanges.firstOrNull { range -> offset >= range.start && offset < range.end }
  }

  private fun calculateEndCoordinates(selectionEnd: Int): Pair<Int, Int> {
    val layout = layout
    val screen = IntArray(2)
    getLocationOnScreen(screen)
    if (layout == null) {
      return Pair(screen[0] + width, screen[1] + height)
    }
    val offset = max(0, min(selectionEnd, text?.length ?: 0))
    val line = layout.getLineForOffset(offset)
    val x = screen[0] + totalPaddingLeft + layout.getPrimaryHorizontal(offset).toInt()
    val y = screen[1] + totalPaddingTop + layout.getLineBottom(line)
    return Pair(x, y)
  }

  private class BlankTokenSpan : ReplacementSpan() {
    override fun getSize(
      paint: Paint,
      text: CharSequence,
      start: Int,
      end: Int,
      fm: Paint.FontMetricsInt?,
    ): Int {
      return paint.measureText(blankText(start, end)).toInt()
    }

    override fun draw(
      canvas: Canvas,
      text: CharSequence,
      start: Int,
      end: Int,
      x: Float,
      top: Int,
      y: Int,
      bottom: Int,
      paint: Paint,
    ) {
      canvas.drawText(blankText(start, end), x, y.toFloat(), paint)
    }

    private fun blankText(start: Int, end: Int): String {
      return "_".repeat(max(1, end - start))
    }
  }

  private class SelectableMessageTextEvent(
    surfaceId: Int,
    viewId: Int,
    private val reactEventName: String,
    private val payload: WritableMap,
  ) : Event<SelectableMessageTextEvent>(surfaceId, viewId) {
    override fun getEventName(): String = reactEventName

    override fun getEventData(): WritableMap = payload
  }
}
`;

const selectableMessageTextManager = (packageName) => `package ${packageName}

import android.graphics.Color
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class SelectableMessageTextManager : SimpleViewManager<SelectableMessageTextView>() {
  override fun getName() = "LFSelectableMessageText"

  override fun createViewInstance(reactContext: ThemedReactContext): SelectableMessageTextView {
    return SelectableMessageTextView(reactContext)
  }

  @ReactProp(name = "text")
  fun setText(view: SelectableMessageTextView, value: String?) {
    view.setDisplayText(value ?: "")
  }

  @ReactProp(name = "fontSize", defaultFloat = 17f)
  fun setFontSize(view: SelectableMessageTextView, value: Float) {
    view.textSize = value
  }

  @ReactProp(name = "lineHeight", defaultFloat = 0f)
  fun setLineHeight(view: SelectableMessageTextView, value: Float) {
    if (value > 0f) {
      val scaledDensity = view.resources.displayMetrics.density * view.resources.configuration.fontScale
      view.setLineSpacing(value - view.textSize * scaledDensity, 1f)
    }
  }

  @ReactProp(name = "color")
  fun setColor(view: SelectableMessageTextView, value: String?) {
    view.setTextColor(parseColor(value))
  }

  @ReactProp(name = "highlightRanges")
  fun setHighlightRanges(view: SelectableMessageTextView, value: ReadableArray?) {
    val ranges = mutableListOf<SelectableMessageTextView.HighlightRange>()
    if (value != null) {
      for (i in 0 until value.size()) {
        val item: ReadableMap = value.getMap(i) ?: continue
        if (!item.hasKey("start") || !item.hasKey("end")) continue
        val start = item.getDouble("start").toInt()
        val end = item.getDouble("end").toInt()
        val groupIndex = if (item.hasKey("groupIndex")) item.getDouble("groupIndex").toInt() else i
        ranges.add(SelectableMessageTextView.HighlightRange(start, end, groupIndex))
      }
    }
    view.setHighlightRanges(ranges)
  }

  @ReactProp(name = "blankRanges")
  fun setBlankRanges(view: SelectableMessageTextView, value: ReadableArray?) {
    val ranges = mutableListOf<SelectableMessageTextView.BlankRange>()
    if (value != null) {
      for (i in 0 until value.size()) {
        val item: ReadableMap = value.getMap(i) ?: continue
        if (!item.hasKey("start") || !item.hasKey("end")) continue
        ranges.add(
          SelectableMessageTextView.BlankRange(
            item.getDouble("start").toInt(),
            item.getDouble("end").toInt(),
          ),
        )
      }
    }
    view.setBlankRanges(ranges)
  }

  override fun getCommandsMap(): MutableMap<String, Int> {
    return mutableMapOf("clearSelection" to COMMAND_CLEAR_SELECTION)
  }

  @Deprecated("Kept for React Native's legacy numeric view command dispatch.")
  override fun receiveCommand(view: SelectableMessageTextView, commandId: Int, args: ReadableArray?) {
    if (commandId == COMMAND_CLEAR_SELECTION) {
      view.clearNativeSelection()
    }
  }

  @Suppress("DEPRECATION")
  override fun receiveCommand(view: SelectableMessageTextView, commandId: String, args: ReadableArray?) {
    if (commandId == "clearSelection") {
      view.clearNativeSelection()
    }
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
    return mutableMapOf(
      "topSelectionChange" to mutableMapOf("registrationName" to "onSelectionChange"),
      "topClozeRangePress" to mutableMapOf("registrationName" to "onClozeRangePress"),
      "topClozeRangeLongPress" to mutableMapOf("registrationName" to "onClozeRangeLongPress"),
    )
  }

  private fun parseColor(value: String?): Int {
    return try {
      if (value.isNullOrBlank()) Color.rgb(17, 17, 17) else Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
      Color.rgb(17, 17, 17)
    }
  }

  companion object {
    private const val COMMAND_CLEAR_SELECTION = 1
  }
}
`;

const selectableMessageTextPackage = (packageName) => `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class SelectableMessageTextPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return listOf(SelectableMessageTextManager())
  }
}
`;

const patchMainApplication = (contents) => {
  if (contents.includes("SelectableMessageTextPackage()")) {
    return contents;
  }

  const marker = "PackageList(this).packages.apply {";
  const markerIndex = contents.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("Cannot find PackageList(this).packages.apply block in MainApplication.kt");
  }

  const insertIndex = contents.indexOf("\n", markerIndex + marker.length);
  return `${contents.slice(0, insertIndex + 1)}              add(SelectableMessageTextPackage())\n${contents.slice(insertIndex + 1)}`;
};

const withSelectableMessageTextAndroid = (config) =>
  withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const packageName = config.android?.package;
      if (!packageName) {
        throw new Error("android.package is required for SelectableMessageText Android plugin");
      }

      const sourceRoot = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app/src/main/java",
        packageToPath(packageName),
      );
      fs.mkdirSync(sourceRoot, { recursive: true });

      fs.writeFileSync(path.join(sourceRoot, "SelectableMessageTextView.kt"), selectableMessageTextView(packageName), "utf8");
      fs.writeFileSync(path.join(sourceRoot, "SelectableMessageTextManager.kt"), selectableMessageTextManager(packageName), "utf8");
      fs.writeFileSync(path.join(sourceRoot, "SelectableMessageTextPackage.kt"), selectableMessageTextPackage(packageName), "utf8");

      const mainApplicationPath = path.join(sourceRoot, "MainApplication.kt");
      const mainApplication = fs.readFileSync(mainApplicationPath, "utf8");
      fs.writeFileSync(mainApplicationPath, patchMainApplication(mainApplication), "utf8");

      return modConfig;
    },
  ]);

module.exports = withSelectableMessageTextAndroid;
