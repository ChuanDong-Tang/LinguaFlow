#import "ChatSelectableTextView.h"
#import <math.h>

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
@property (nonatomic, assign) CGFloat lastReportedContentHeight;
- (void)handleFillBlankAction;
- (void)handleMenuActionAtIndex:(NSUInteger)index;
- (void)handleCopyAction;
@end

@interface ChatSelectableTextInnerTextView : UITextView
@property (nonatomic, weak) ChatSelectableTextView *owner;
@end

@implementation ChatSelectableTextInnerTextView

- (BOOL)canPerformAction:(SEL)action withSender:(id)sender
{
  NSInteger menuIndex = [self chatMenuIndexForAction:action];
  if (menuIndex >= 0) {
    return [self.owner.selectionMode isEqualToString:@"range"] &&
      menuIndex < (NSInteger)self.owner.menuOptions.count &&
      self.selectedRange.length > 0;
  }
  if (action == @selector(chatCopy:)) {
    return [self.owner.selectionMode isEqualToString:@"all"] && self.selectedRange.length > 0;
  }
  if (action == @selector(copy:)) {
    return NO;
  }
  return NO;
}

- (NSInteger)chatMenuIndexForAction:(SEL)action
{
  if (action == @selector(chatMenuAction0:)) return 0;
  if (action == @selector(chatMenuAction1:)) return 1;
  if (action == @selector(chatMenuAction2:)) return 2;
  if (action == @selector(chatMenuAction3:)) return 3;
  if (action == @selector(chatMenuAction4:)) return 4;
  if (action == @selector(chatMenuAction5:)) return 5;
  if (action == @selector(chatMenuAction6:)) return 6;
  if (action == @selector(chatMenuAction7:)) return 7;
  return -1;
}

- (void)chatMenuAction0:(id)sender { [self.owner handleMenuActionAtIndex:0]; }
- (void)chatMenuAction1:(id)sender { [self.owner handleMenuActionAtIndex:1]; }
- (void)chatMenuAction2:(id)sender { [self.owner handleMenuActionAtIndex:2]; }
- (void)chatMenuAction3:(id)sender { [self.owner handleMenuActionAtIndex:3]; }
- (void)chatMenuAction4:(id)sender { [self.owner handleMenuActionAtIndex:4]; }
- (void)chatMenuAction5:(id)sender { [self.owner handleMenuActionAtIndex:5]; }
- (void)chatMenuAction6:(id)sender { [self.owner handleMenuActionAtIndex:6]; }
- (void)chatMenuAction7:(id)sender { [self.owner handleMenuActionAtIndex:7]; }

- (void)chatCopy:(id)sender
{
  [self.owner handleCopyAction];
}

- (void)copy:(id)sender
{
  [self.owner handleCopyAction];
}

- (void)drawRect:(CGRect)rect
{
  [super drawRect:rect];
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
    _lastReportedContentHeight = 0;

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
  [self emitContentHeightIfNeeded];
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

- (void)setOnContentHeightChange:(RCTDirectEventBlock)onContentHeightChange
{
  _onContentHeightChange = [onContentHeightChange copy];
  [self emitContentHeightIfNeeded];
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
  [self emitContentHeightIfNeeded];
}

- (void)emitContentHeightIfNeeded
{
  if (!self.onContentHeightChange) return;
  CGFloat width = self.bounds.size.width;
  if (width <= 0) return;
  CGSize fittingSize = [self.textView sizeThatFits:CGSizeMake(width, CGFLOAT_MAX)];
  CGFloat nextHeight = ceil(MAX(fittingSize.height, self.currentLineHeight.floatValue));
  if (fabs(nextHeight - self.lastReportedContentHeight) < 1.0) return;
  self.lastReportedContentHeight = nextHeight;
  self.onContentHeightChange(@{ @"height": @(nextHeight) });
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
  NSMutableArray<UIMenuItem *> *items = [NSMutableArray new];
  NSArray<NSValue *> *actions = @[
    [NSValue valueWithPointer:@selector(chatMenuAction0:)],
    [NSValue valueWithPointer:@selector(chatMenuAction1:)],
    [NSValue valueWithPointer:@selector(chatMenuAction2:)],
    [NSValue valueWithPointer:@selector(chatMenuAction3:)],
    [NSValue valueWithPointer:@selector(chatMenuAction4:)],
    [NSValue valueWithPointer:@selector(chatMenuAction5:)],
    [NSValue valueWithPointer:@selector(chatMenuAction6:)],
    [NSValue valueWithPointer:@selector(chatMenuAction7:)]
  ];
  NSUInteger count = MIN(self.menuOptions.count, actions.count);
  for (NSUInteger index = 0; index < count; index += 1) {
    SEL action = (SEL)[actions[index] pointerValue];
    [items addObject:[[UIMenuItem alloc] initWithTitle:self.menuOptions[index] action:action]];
  }
  UIMenuController.sharedMenuController.menuItems = items;
}

- (void)handleFillBlankAction
{
  [self handleMenuActionAtIndex:0];
}

- (void)handleMenuActionAtIndex:(NSUInteger)index
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
    CGRect selectionRect = [self selectionRectForRange:selectedRange];
    self.onSelection(@{
      @"chosenOption": index < self.menuOptions.count ? self.menuOptions[index] : @"",
      @"highlightedText": selectedText ?: @"",
      @"selectionStart": @(safeStart),
      @"selectionEnd": @(safeEnd),
      @"selectionRect": @{
        @"pageX": @(selectionRect.origin.x),
        @"pageY": @(selectionRect.origin.y),
        @"width": @(selectionRect.size.width),
        @"height": @(selectionRect.size.height)
      }
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

- (CGRect)selectionRectForRange:(NSRange)range
{
  if (range.location == NSNotFound || range.length == 0 || self.textView.textStorage.length == 0) {
    return CGRectZero;
  }
  NSRange safeRange = NSMakeRange(MIN(range.location, self.textView.textStorage.length), 0);
  NSUInteger safeEnd = MIN(NSMaxRange(range), self.textView.textStorage.length);
  safeRange.length = safeEnd > safeRange.location ? safeEnd - safeRange.location : 0;
  if (safeRange.length == 0) return CGRectZero;

  NSLayoutManager *layoutManager = self.textView.layoutManager;
  NSTextContainer *container = self.textView.textContainer;
  NSRange glyphRange = [layoutManager glyphRangeForCharacterRange:safeRange actualCharacterRange:nil];
  __block CGRect unionRect = CGRectNull;
  [layoutManager enumerateEnclosingRectsForGlyphRange:glyphRange
                            withinSelectedGlyphRange:NSMakeRange(NSNotFound, 0)
                                     inTextContainer:container
                                          usingBlock:^(CGRect rect, BOOL *stop) {
    CGRect adjusted = CGRectOffset(rect, self.textView.textContainerInset.left, self.textView.textContainerInset.top);
    unionRect = CGRectIsNull(unionRect) ? adjusted : CGRectUnion(unionRect, adjusted);
  }];
  if (CGRectIsNull(unionRect)) return CGRectZero;
  return [self.textView convertRect:unionRect toView:nil];
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
