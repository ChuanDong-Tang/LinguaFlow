const { IOSConfig, withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const { addBuildSourceFileToGroup } = require("@expo/config-plugins/build/ios/utils/Xcodeproj");
const fs = require("node:fs");
const path = require("node:path");

const IOS_FILES = {
  "ChatSelectableTextView.h": String.raw`#import <UIKit/UIKit.h>
#import <React/RCTComponent.h>

@interface ChatSelectableTextView : UIView

@property (nonatomic, copy) RCTDirectEventBlock onSelectionStart;
@property (nonatomic, copy) RCTDirectEventBlock onSelection;
@property (nonatomic, copy) RCTDirectEventBlock onClozeRangePress;
@property (nonatomic, copy) RCTDirectEventBlock onClozeRangeLongPress;

- (void)setText:(NSString *)text;
- (void)setHighlightRangesJson:(NSString *)json;
- (void)setBlankRangesJson:(NSString *)json;
- (void)setCorrectRangesJson:(NSString *)json;
- (void)setAnswersVisible:(BOOL)visible;
- (void)setTextColor:(NSString *)color;
- (void)setFontSize:(NSNumber *)fontSize;
- (void)setLineHeight:(NSNumber *)lineHeight;
- (void)setFontWeight:(NSString *)fontWeight;
- (void)setMenuOptions:(NSArray<NSString *> *)menuOptions;
- (void)setSelectionMode:(NSString *)selectionMode;
- (void)clearSelectionState;

@end
`,
  "ChatSelectableTextView.m": String.raw`#import "ChatSelectableTextView.h"

@class ChatSelectableTextInnerTextView;

@interface ChatSelectableTextView () <UITextViewDelegate, UIGestureRecognizerDelegate>
@property (nonatomic, strong) ChatSelectableTextInnerTextView *textView;
@property (nonatomic, copy) NSString *rawText;
@property (nonatomic, copy) NSString *highlightRangesJson;
@property (nonatomic, copy) NSString *blankRangesJson;
@property (nonatomic, copy) NSString *correctRangesJson;
@property (nonatomic, copy) NSArray<NSString *> *menuOptions;
@property (nonatomic, strong) UIColor *currentTextColor;
@property (nonatomic, strong) NSNumber *currentFontSize;
@property (nonatomic, strong) NSNumber *currentLineHeight;
@property (nonatomic, copy) NSString *currentFontWeight;
@property (nonatomic, copy) NSString *selectionMode;
@property (nonatomic, strong) UITapGestureRecognizer *rangeTapRecognizer;
@property (nonatomic, strong) UITapGestureRecognizer *doubleTapBlocker;
@property (nonatomic, strong) UITapGestureRecognizer *outsideSelectionTapRecognizer;
@property (nonatomic, strong) UILongPressGestureRecognizer *rangeLongPressRecognizer;
@property (nonatomic, strong) UILongPressGestureRecognizer *selectAllLongPressRecognizer;
@property (nonatomic, assign) BOOL answersVisible;
@property (nonatomic, assign) BOOL hasEmittedSelectionStart;
@property (nonatomic, assign) BOOL pendingSelectionRelease;
@property (nonatomic, assign) NSRange lastSelectedRange;
@property (nonatomic, assign) BOOL hasLastSelectedRange;
- (void)handleFillBlankAction;
- (void)handleCopyAction;
@end

@interface ChatSelectableTextInnerTextView : UITextView
@property (nonatomic, weak) ChatSelectableTextView *owner;
@end

@implementation ChatSelectableTextInnerTextView

- (BOOL)canPerformAction:(SEL)action withSender:(id)sender
{
  if (action == @selector(chatFillBlank:)) {
    return [self.owner.selectionMode isEqualToString:@"range"] && self.owner.menuOptions.count > 0 && self.selectedRange.length > 0;
  }
  if (action == @selector(chatCopy:)) {
    return [self.owner.selectionMode isEqualToString:@"all"] && self.selectedRange.length > 0;
  }
  if (action == @selector(copy:)) {
    return NO;
  }
  return NO;
}

- (void)chatFillBlank:(id)sender
{
  [self.owner handleFillBlankAction];
}

- (void)chatCopy:(id)sender
{
  [self.owner handleCopyAction];
}

- (void)copy:(id)sender
{
  [self.owner handleCopyAction];
}

@end

@implementation ChatSelectableTextView

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _rawText = @"";
    _highlightRangesJson = @"[]";
    _blankRangesJson = @"[]";
    _correctRangesJson = @"[]";
    _menuOptions = @[];
    _currentTextColor = [UIColor colorWithRed:17.0 / 255.0 green:17.0 / 255.0 blue:17.0 / 255.0 alpha:1.0];
    _currentFontSize = @17;
    _currentLineHeight = @25;
    _currentFontWeight = @"";
    _selectionMode = @"range";
    _lastSelectedRange = NSMakeRange(0, 0);
    _hasLastSelectedRange = NO;

    _textView = [[ChatSelectableTextInnerTextView alloc] initWithFrame:self.bounds];
    _textView.owner = self;
    _textView.delegate = self;
    _textView.editable = NO;
    _textView.selectable = YES;
    _textView.scrollEnabled = NO;
    _textView.backgroundColor = UIColor.clearColor;
    _textView.textContainerInset = UIEdgeInsetsZero;
    _textView.textContainer.lineFragmentPadding = 0;
    _textView.showsVerticalScrollIndicator = NO;
    _textView.showsHorizontalScrollIndicator = NO;
    _textView.dataDetectorTypes = UIDataDetectorTypeNone;
    [self addSubview:_textView];

    _doubleTapBlocker = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleDoubleTapBlock:)];
    _doubleTapBlocker.numberOfTapsRequired = 2;
    _doubleTapBlocker.delegate = self;
    _doubleTapBlocker.cancelsTouchesInView = YES;
    [_textView addGestureRecognizer:_doubleTapBlocker];

    _rangeTapRecognizer = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleRangeTap:)];
    _rangeTapRecognizer.delegate = self;
    _rangeTapRecognizer.cancelsTouchesInView = NO;
    [_rangeTapRecognizer requireGestureRecognizerToFail:_doubleTapBlocker];
    [_textView addGestureRecognizer:_rangeTapRecognizer];

    _rangeLongPressRecognizer = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(handleRangeLongPress:)];
    _rangeLongPressRecognizer.delegate = self;
    _rangeLongPressRecognizer.cancelsTouchesInView = YES;
    [_textView addGestureRecognizer:_rangeLongPressRecognizer];

    _selectAllLongPressRecognizer = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(handleSelectAllLongPress:)];
    _selectAllLongPressRecognizer.delegate = self;
    _selectAllLongPressRecognizer.cancelsTouchesInView = YES;
    [_textView addGestureRecognizer:_selectAllLongPressRecognizer];

    [self applyText];
  }
  return self;
}

- (void)dealloc
{
  [self stopObservingOutsideSelectionTaps];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.textView.selectedRange.length > 0) {
    [self startObservingOutsideSelectionTaps];
  } else {
    [self stopObservingOutsideSelectionTaps];
  }
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  self.textView.frame = self.bounds;
}

- (void)setText:(NSString *)text
{
  _rawText = text ?: @"";
  _lastSelectedRange = NSMakeRange(0, 0);
  _hasLastSelectedRange = NO;
  [self applyText];
}

- (void)setHighlightRangesJson:(NSString *)json
{
  _highlightRangesJson = json ?: @"[]";
  [self applyText];
}

- (void)setBlankRangesJson:(NSString *)json
{
  _blankRangesJson = json ?: @"[]";
  [self applyText];
}

- (void)setCorrectRangesJson:(NSString *)json
{
  _correctRangesJson = json ?: @"[]";
  [self applyText];
}

- (void)setAnswersVisible:(BOOL)visible
{
  _answersVisible = visible;
  [self applyText];
}

- (void)setTextColor:(NSString *)color
{
  _currentTextColor = [self colorFromString:color fallback:self.currentTextColor];
  [self applyText];
}

- (void)setFontSize:(NSNumber *)fontSize
{
  _currentFontSize = fontSize ?: @17;
  [self applyText];
}

- (void)setLineHeight:(NSNumber *)lineHeight
{
  _currentLineHeight = lineHeight ?: @25;
  [self applyText];
}

- (void)setFontWeight:(NSString *)fontWeight
{
  _currentFontWeight = fontWeight ?: @"";
  [self applyText];
}

- (void)setMenuOptions:(NSArray<NSString *> *)menuOptions
{
  _menuOptions = [menuOptions isKindOfClass:NSArray.class] ? menuOptions : @[];
  [self updateMenuItems];
}

- (void)setSelectionMode:(NSString *)selectionMode
{
  if ([selectionMode isEqualToString:@"all"]) {
    _selectionMode = @"all";
  } else {
    _selectionMode = @"range";
  }
  [self updateMenuItems];
}

- (void)clearSelectionState
{
  [NSObject cancelPreviousPerformRequestsWithTarget:self.textView];
  [self stopObservingOutsideSelectionTaps];
  [self.textView resignFirstResponder];
  if (@available(iOS 13.0, *)) {
    [UIMenuController.sharedMenuController hideMenu];
  }
  [self scheduleSelectionRelease];
}

- (void)scheduleSelectionRelease
{
  if (self.pendingSelectionRelease) {
    return;
  }
  self.pendingSelectionRelease = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    self.pendingSelectionRelease = NO;
    self.textView.selectedRange = NSMakeRange(0, 0);
    self.hasEmittedSelectionStart = NO;
    [self.textView resignFirstResponder];
  });
}

- (void)startObservingOutsideSelectionTaps
{
  if (!self.window || self.outsideSelectionTapRecognizer) {
    return;
  }
  self.outsideSelectionTapRecognizer = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleOutsideSelectionTap:)];
  self.outsideSelectionTapRecognizer.delegate = self;
  self.outsideSelectionTapRecognizer.cancelsTouchesInView = NO;
  [self.window addGestureRecognizer:self.outsideSelectionTapRecognizer];
}

- (void)stopObservingOutsideSelectionTaps
{
  if (!self.outsideSelectionTapRecognizer) {
    return;
  }
  [self.outsideSelectionTapRecognizer.view removeGestureRecognizer:self.outsideSelectionTapRecognizer];
  self.outsideSelectionTapRecognizer = nil;
}

- (void)applyText
{
  NSArray<NSDictionary *> *blankRanges = [self parseRanges:self.blankRangesJson];
  NSString *visibleText = [self visibleTextForText:self.rawText blankRanges:blankRanges answersVisible:self.answersVisible];
  NSMutableAttributedString *attributed = [[NSMutableAttributedString alloc] initWithString:visibleText ?: @""];
  NSRange fullRange = NSMakeRange(0, attributed.length);

  UIFont *font = [self fontForCurrentStyle];
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.minimumLineHeight = self.currentLineHeight.floatValue;
  paragraph.maximumLineHeight = self.currentLineHeight.floatValue;
  [attributed addAttributes:@{
    NSForegroundColorAttributeName: self.currentTextColor,
    NSFontAttributeName: font,
    NSParagraphStyleAttributeName: paragraph
  } range:fullRange];

  for (NSDictionary *range in [self parseRanges:self.highlightRangesJson]) {
    NSRange safe = [self safeRangeFromDictionary:range length:attributed.length];
    if (safe.length == 0) continue;
    [attributed addAttribute:NSBackgroundColorAttributeName value:[self colorFromString:@"#FFF0B8" fallback:UIColor.yellowColor] range:safe];
    [attributed addAttribute:NSForegroundColorAttributeName value:[self colorFromString:@"#3D3420" fallback:self.currentTextColor] range:safe];
  }

  UIFont *boldFont = [UIFont boldSystemFontOfSize:self.currentFontSize.floatValue];
  for (NSDictionary *range in blankRanges) {
    NSRange safe = [self safeRangeFromDictionary:range length:attributed.length];
    if (safe.length == 0) continue;
    [attributed addAttribute:NSForegroundColorAttributeName value:[self colorFromString:@"#8C6D1F" fallback:self.currentTextColor] range:safe];
    [attributed addAttribute:NSFontAttributeName value:boldFont range:safe];
  }

  for (NSDictionary *range in [self parseRanges:self.correctRangesJson]) {
    NSRange safe = [self safeRangeFromDictionary:range length:attributed.length];
    if (safe.length == 0) continue;
    [attributed addAttribute:NSForegroundColorAttributeName value:[self colorFromString:@"#6FAE78" fallback:self.currentTextColor] range:safe];
  }

  NSRange previousSelection = self.textView.selectedRange;
  self.textView.attributedText = attributed;
  if (previousSelection.location != NSNotFound && NSMaxRange(previousSelection) <= attributed.length) {
    self.textView.selectedRange = previousSelection;
  }
  [self updateMenuItems];
}

- (UIFont *)fontForCurrentStyle
{
  NSString *weight = self.currentFontWeight ?: @"";
  if ([weight isEqualToString:@"bold"] || [weight isEqualToString:@"700"] || [weight isEqualToString:@"800"] || [weight isEqualToString:@"900"]) {
    return [UIFont boldSystemFontOfSize:self.currentFontSize.floatValue];
  }
  return [UIFont systemFontOfSize:self.currentFontSize.floatValue];
}

- (void)updateMenuItems
{
  if ([self.selectionMode isEqualToString:@"all"]) {
    UIMenuItem *item = [[UIMenuItem alloc] initWithTitle:@"复制" action:@selector(chatCopy:)];
    UIMenuController.sharedMenuController.menuItems = @[item];
    return;
  }
  if (![self.selectionMode isEqualToString:@"range"] || self.menuOptions.count == 0) {
    UIMenuController.sharedMenuController.menuItems = nil;
    return;
  }
  UIMenuItem *item = [[UIMenuItem alloc] initWithTitle:self.menuOptions.firstObject action:@selector(chatFillBlank:)];
  UIMenuController.sharedMenuController.menuItems = @[item];
}

- (void)handleFillBlankAction
{
  NSRange selectedRange = self.textView.selectedRange;
  if (selectedRange.location == NSNotFound || selectedRange.length == 0) {
    return;
  }
  NSUInteger safeStart = MIN(selectedRange.location, self.rawText.length);
  NSUInteger safeEnd = MIN(NSMaxRange(selectedRange), self.rawText.length);
  if (safeEnd < safeStart) {
    safeEnd = safeStart;
  }
  NSString *selectedText = [self.rawText substringWithRange:NSMakeRange(safeStart, safeEnd - safeStart)];
  if (self.onSelection) {
    self.onSelection(@{
      @"chosenOption": self.menuOptions.firstObject ?: @"",
      @"highlightedText": selectedText ?: @"",
      @"selectionStart": @(safeStart),
      @"selectionEnd": @(safeEnd)
    });
  }
  [self clearSelectionState];
}

- (void)handleCopyAction
{
  NSRange selectedRange = self.textView.selectedRange;
  if ((selectedRange.location == NSNotFound || selectedRange.length == 0) && self.hasLastSelectedRange) {
    selectedRange = self.lastSelectedRange;
  }
  if (selectedRange.location == NSNotFound || selectedRange.length == 0) {
    return;
  }
  NSUInteger safeStart = MIN(selectedRange.location, self.rawText.length);
  NSUInteger safeEnd = MIN(NSMaxRange(selectedRange), self.rawText.length);
  if (safeEnd < safeStart) {
    safeEnd = safeStart;
  }
  NSString *selectedText = [self.rawText substringWithRange:NSMakeRange(safeStart, safeEnd - safeStart)];
  if (selectedText.length > 0) {
    UIPasteboard.generalPasteboard.string = selectedText;
  }
  self.lastSelectedRange = NSMakeRange(0, 0);
  self.hasLastSelectedRange = NO;
  [self clearSelectionState];
}

- (void)textViewDidChangeSelection:(UITextView *)textView
{
  if (textView.selectedRange.length > 0 && !self.hasEmittedSelectionStart) {
    self.lastSelectedRange = textView.selectedRange;
    self.hasLastSelectedRange = YES;
    self.hasEmittedSelectionStart = YES;
    [self startObservingOutsideSelectionTaps];
    [self updateMenuItems];
    UIMenuController *menu = UIMenuController.sharedMenuController;
    if (menu.isMenuVisible) {
      [menu update];
    }
    if (self.onSelectionStart) {
      self.onSelectionStart(@{});
    }
  } else if (textView.selectedRange.length == 0) {
    self.hasEmittedSelectionStart = NO;
    [self stopObservingOutsideSelectionTaps];
  } else if (textView.selectedRange.length > 0) {
    self.lastSelectedRange = textView.selectedRange;
    self.hasLastSelectedRange = YES;
  }
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldReceiveTouch:(UITouch *)touch
{
  CGPoint point = [touch locationInView:self.textView];
  if (gestureRecognizer == self.outsideSelectionTapRecognizer) {
    return self.textView.selectedRange.length > 0 &&
      !UIMenuController.sharedMenuController.isMenuVisible &&
      ![touch.view isDescendantOfView:self];
  }
  if (gestureRecognizer == self.doubleTapBlocker) {
    return YES;
  }
  if (gestureRecognizer == self.selectAllLongPressRecognizer) {
    return [self.selectionMode isEqualToString:@"all"] && self.rawText.length > 0;
  }
  if (gestureRecognizer == self.rangeTapRecognizer || gestureRecognizer == self.rangeLongPressRecognizer) {
    return [self.selectionMode isEqualToString:@"range"] && [self highlightRangeAtPoint:point] != nil;
  }
  return YES;
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  if (gestureRecognizer == self.doubleTapBlocker || otherGestureRecognizer == self.doubleTapBlocker) {
    return NO;
  }
  if (gestureRecognizer == self.selectAllLongPressRecognizer || otherGestureRecognizer == self.selectAllLongPressRecognizer) {
    return NO;
  }
  if (gestureRecognizer == self.outsideSelectionTapRecognizer || otherGestureRecognizer == self.outsideSelectionTapRecognizer) {
    return YES;
  }
  return YES;
}

- (void)handleDoubleTapBlock:(UITapGestureRecognizer *)recognizer
{
  if (recognizer.state != UIGestureRecognizerStateEnded) return;
}

- (void)handleOutsideSelectionTap:(UITapGestureRecognizer *)recognizer
{
  if (recognizer.state != UIGestureRecognizerStateEnded) return;
  [self clearSelectionState];
}

- (void)handleRangeTap:(UITapGestureRecognizer *)recognizer
{
  if (recognizer.state != UIGestureRecognizerStateEnded) return;
  NSDictionary *range = [self highlightRangeAtPoint:[recognizer locationInView:self.textView]];
  if (!range || !self.onClozeRangePress) return;
  self.onClozeRangePress(@{ @"groupIndex": range[@"groupIndex"] ?: @0 });
}

- (void)handleRangeLongPress:(UILongPressGestureRecognizer *)recognizer
{
  if (recognizer.state != UIGestureRecognizerStateBegan) return;
  NSDictionary *range = [self highlightRangeAtPoint:[recognizer locationInView:self.textView]];
  if (!range || !self.onClozeRangeLongPress) return;
  [self clearSelectionState];
  self.onClozeRangeLongPress(@{ @"groupIndex": range[@"groupIndex"] ?: @0 });
}

- (void)handleSelectAllLongPress:(UILongPressGestureRecognizer *)recognizer
{
  if (recognizer.state != UIGestureRecognizerStateBegan) return;
  if (![self.selectionMode isEqualToString:@"all"] || self.rawText.length == 0) return;
  [self.textView becomeFirstResponder];
  self.textView.selectedRange = NSMakeRange(0, self.textView.textStorage.length);
  self.lastSelectedRange = self.textView.selectedRange;
  self.hasLastSelectedRange = YES;
  self.hasEmittedSelectionStart = YES;
  [self startObservingOutsideSelectionTaps];
  if (self.onSelectionStart) {
    self.onSelectionStart(@{});
  }
  [self updateMenuItems];
  UIMenuController *menu = UIMenuController.sharedMenuController;
  [menu setTargetRect:self.textView.bounds inView:self.textView];
  [menu setMenuVisible:YES animated:YES];
}

- (NSDictionary *)highlightRangeAtPoint:(CGPoint)point
{
  NSUInteger index = [self characterIndexAtPoint:point];
  if (index == NSNotFound) return nil;
  for (NSDictionary *range in [self parseRanges:self.highlightRangesJson]) {
    NSInteger start = [range[@"start"] integerValue];
    NSInteger end = [range[@"end"] integerValue];
    if (index >= start && index < end) {
      return range;
    }
  }
  return nil;
}

- (NSUInteger)characterIndexAtPoint:(CGPoint)point
{
  NSTextContainer *container = self.textView.textContainer;
  NSLayoutManager *layoutManager = self.textView.layoutManager;
  CGPoint adjusted = CGPointMake(point.x - self.textView.textContainerInset.left, point.y - self.textView.textContainerInset.top);
  if (adjusted.x < 0 || adjusted.y < 0 || adjusted.x > self.textView.bounds.size.width || adjusted.y > self.textView.bounds.size.height) {
    return NSNotFound;
  }
  CGFloat fraction = 0;
  NSUInteger index = [layoutManager characterIndexForPoint:adjusted inTextContainer:container fractionOfDistanceBetweenInsertionPoints:&fraction];
  if (index >= self.textView.textStorage.length) return NSNotFound;
  return index;
}

- (NSArray<NSDictionary *> *)parseRanges:(NSString *)json
{
  NSData *data = [(json ?: @"[]") dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return @[];
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![value isKindOfClass:NSArray.class]) return @[];
  NSMutableArray<NSDictionary *> *ranges = [NSMutableArray new];
  NSInteger index = 0;
  for (id item in (NSArray *)value) {
    if (![item isKindOfClass:NSDictionary.class]) continue;
    NSInteger start = [item[@"start"] integerValue];
    NSInteger end = [item[@"end"] integerValue];
    NSInteger groupIndex = item[@"groupIndex"] ? [item[@"groupIndex"] integerValue] : index;
    if (start < end) {
      [ranges addObject:@{ @"start": @(start), @"end": @(end), @"groupIndex": @(groupIndex) }];
    }
    index += 1;
  }
  return ranges;
}

- (NSRange)safeRangeFromDictionary:(NSDictionary *)range length:(NSUInteger)length
{
  NSUInteger start = MIN((NSUInteger)MAX(0, [range[@"start"] integerValue]), length);
  NSUInteger end = MIN((NSUInteger)MAX((NSInteger)start, [range[@"end"] integerValue]), length);
  return NSMakeRange(start, end - start);
}

- (NSString *)visibleTextForText:(NSString *)text blankRanges:(NSArray<NSDictionary *> *)blankRanges answersVisible:(BOOL)answersVisible
{
  if (answersVisible || blankRanges.count == 0) return text ?: @"";
  NSMutableString *mutable = [(text ?: @"") mutableCopy];
  for (NSDictionary *range in blankRanges) {
    NSRange safe = [self safeRangeFromDictionary:range length:mutable.length];
    for (NSUInteger index = safe.location; index < NSMaxRange(safe); index += 1) {
      unichar ch = [mutable characterAtIndex:index];
      if (![[NSCharacterSet whitespaceAndNewlineCharacterSet] characterIsMember:ch]) {
        [mutable replaceCharactersInRange:NSMakeRange(index, 1) withString:@"_"];
      }
    }
  }
  return mutable;
}

- (UIColor *)colorFromString:(NSString *)value fallback:(UIColor *)fallback
{
  if (![value isKindOfClass:NSString.class] || ![value hasPrefix:@"#"]) return fallback;
  NSString *hex = [value substringFromIndex:1];
  if (hex.length != 6) return fallback;
  unsigned int rgb = 0;
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  if (![scanner scanHexInt:&rgb]) return fallback;
  return [UIColor colorWithRed:((rgb >> 16) & 0xFF) / 255.0
                         green:((rgb >> 8) & 0xFF) / 255.0
                          blue:(rgb & 0xFF) / 255.0
                         alpha:1.0];
}

@end
`,
  "ChatSelectableTextViewManager.m": String.raw`#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>
#import "ChatSelectableTextView.h"

@interface ChatSelectableTextViewManager : RCTViewManager
@end

@implementation ChatSelectableTextViewManager

RCT_EXPORT_MODULE(ChatSelectableTextView)

- (UIView *)view
{
  return [ChatSelectableTextView new];
}

RCT_EXPORT_VIEW_PROPERTY(text, NSString)
RCT_EXPORT_VIEW_PROPERTY(highlightRangesJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(blankRangesJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(correctRangesJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(answersVisible, BOOL)
RCT_EXPORT_VIEW_PROPERTY(textColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(fontSize, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(lineHeight, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(fontWeight, NSString)
RCT_EXPORT_VIEW_PROPERTY(menuOptions, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectionMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(onSelectionStart, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSelection, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onClozeRangePress, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onClozeRangeLongPress, RCTDirectEventBlock)

RCT_EXPORT_METHOD(clearSelection:(nonnull NSNumber *)reactTag)
{
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) {
    UIView *view = viewRegistry[reactTag];
    if ([view isKindOfClass:ChatSelectableTextView.class]) {
      [(ChatSelectableTextView *)view clearSelectionState];
    }
  }];
}

@end
`,
};

module.exports = function withChatSelectableText(config) {
  return withAndroidSelectableText(
    withXcodeProject(config, (iosConfig) => {
    const iosRoot = iosConfig.modRequest.platformProjectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(iosConfig.modRequest.projectRoot);
    const sourceRoot = path.join(iosRoot, projectName);
    fs.mkdirSync(sourceRoot, { recursive: true });

    for (const [filename, contents] of Object.entries(IOS_FILES)) {
      const filePath = path.join(sourceRoot, filename);
      fs.writeFileSync(filePath, contents);
      addBuildSourceFileToGroup({
        filepath: `${projectName}/${filename}`,
        groupName: projectName,
        project: iosConfig.modResults,
      });
    }

    return iosConfig;
    })
  );
};

function withAndroidSelectableText(config) {
  const androidPackage = config.android?.package;
  if (!androidPackage) {
    throw new Error("with-chat-selectable-text requires expo.android.package to locate MainApplication.kt");
  }

  return withDangerousMod(config, [
    "android",
    (androidConfig) => {
      const androidRoot = androidConfig.modRequest.platformProjectRoot;
      const packagePath = androidPackage.split(".");
      const javaRoot = path.join(androidRoot, "app", "src", "main", "java", ...packagePath);
      const targetRoot = path.join(javaRoot, "chatselectabletext");
      const templateRoot = path.join(__dirname, "chat-selectable-text", "android");
      fs.mkdirSync(targetRoot, { recursive: true });
      for (const filename of [
        "ChatSelectableTextPackage.kt",
        "ChatSelectableTextView.kt",
        "ChatSelectableTextViewManager.kt",
      ]) {
        const source = fs.readFileSync(path.join(templateRoot, filename), "utf8");
        fs.writeFileSync(
          path.join(targetRoot, filename),
          source.replace(
            "package com.yueyantech.oio.chatselectabletext",
            `package ${androidPackage}.chatselectabletext`
          )
        );
      }
      patchMainApplication(path.join(javaRoot, "MainApplication.kt"), androidPackage);
      return androidConfig;
    },
  ]);
}

function patchMainApplication(filePath, androidPackage) {
  let text = fs.readFileSync(filePath, "utf8");
  const packageImport = `import ${androidPackage}.chatselectabletext.ChatSelectableTextPackage`;
  if (!text.includes(packageImport)) {
    text = text.replace(
      "import expo.modules.ReactNativeHostWrapper\n",
      `import expo.modules.ReactNativeHostWrapper\n${packageImport}\n`
    );
  }
  if (!text.includes("add(ChatSelectableTextPackage())")) {
    text = text.replace(
      "              // Packages that cannot be autolinked yet can be added manually here, for example:\n              // add(MyReactNativePackage())",
      "              // Packages that cannot be autolinked yet can be added manually here, for example:\n              // add(MyReactNativePackage())\n              add(ChatSelectableTextPackage())"
    );
  }
  fs.writeFileSync(filePath, text);
}
