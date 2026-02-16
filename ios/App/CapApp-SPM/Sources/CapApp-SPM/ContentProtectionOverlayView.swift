import Foundation
import UIKit
import WebKit

enum ContentProtectionOverlayMode {
    case hidden
    case soft
    case hard
}

final class ContentProtectionOverlayView {
    private weak var webView: WKWebView?
    private weak var parentView: UIView?
    private var overlayView: UIView?
    private var blurView: UIVisualEffectView?
    private var messageContainer: UIStackView?
    private var titleLabel: UILabel?
    private var actionButton: UIButton?

    private var mode: ContentProtectionOverlayMode = .hidden
    private var allowReveal = false
    private var onRevealTap: (() -> Void)?

    func attach(to webView: WKWebView) {
        if self.webView === webView, overlayView != nil {
            return
        }
        detach()

        self.webView = webView
        self.parentView = webView.superview
        guard let parent = webView.superview else { return }

        let overlay = UIView(frame: webView.frame)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.backgroundColor = UIColor.clear
        overlay.isUserInteractionEnabled = true
        overlay.isHidden = true
        overlay.alpha = 0

        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        blur.translatesAutoresizingMaskIntoConstraints = false
        blur.alpha = 0.85
        overlay.addSubview(blur)
        NSLayoutConstraint.activate([
            blur.topAnchor.constraint(equalTo: overlay.topAnchor),
            blur.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
            blur.bottomAnchor.constraint(equalTo: overlay.bottomAnchor)
        ])

        let dim = UIView()
        dim.translatesAutoresizingMaskIntoConstraints = false
        dim.backgroundColor = UIColor.black.withAlphaComponent(0.26)
        overlay.addSubview(dim)
        NSLayoutConstraint.activate([
            dim.topAnchor.constraint(equalTo: overlay.topAnchor),
            dim.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
            dim.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
            dim.bottomAnchor.constraint(equalTo: overlay.bottomAnchor)
        ])

        let title = UILabel()
        title.text = "Protected content blurred"
        title.textColor = .white
        title.textAlignment = .center
        title.font = UIFont.preferredFont(forTextStyle: .headline)
        title.numberOfLines = 2

        let button = UIButton(type: .system)
        button.setTitle("Tap to Reveal", for: .normal)
        button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = UIFont.preferredFont(forTextStyle: .subheadline)
        button.backgroundColor = UIColor.white.withAlphaComponent(0.14)
        button.layer.cornerRadius = 10
        button.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        button.addTarget(self, action: #selector(didTapActionButton), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -16)
        ])

        parent.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: webView.topAnchor),
            overlay.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            overlay.bottomAnchor.constraint(equalTo: webView.bottomAnchor)
        ])

        parent.bringSubviewToFront(overlay)

        overlayView = overlay
        blurView = blur
        messageContainer = stack
        titleLabel = title
        actionButton = button

        setMode(.hidden, animated: false, allowReveal: false, onRevealTap: nil)
    }

    func detach() {
        overlayView?.removeFromSuperview()
        overlayView = nil
        blurView = nil
        messageContainer = nil
        titleLabel = nil
        actionButton = nil
        webView = nil
        parentView = nil
        mode = .hidden
        onRevealTap = nil
    }

    func setMode(
        _ mode: ContentProtectionOverlayMode,
        animated: Bool,
        allowReveal: Bool,
        onRevealTap: (() -> Void)?
    ) {
        self.mode = mode
        self.allowReveal = allowReveal
        self.onRevealTap = onRevealTap

        guard let overlayView, let blurView, let messageContainer, let actionButton else {
            return
        }

        let changes = {
            switch mode {
            case .hidden:
                overlayView.isUserInteractionEnabled = false
                overlayView.alpha = 0
                blurView.effect = UIBlurEffect(style: .systemThinMaterialDark)
                messageContainer.alpha = 0
            case .soft:
                overlayView.isUserInteractionEnabled = false
                overlayView.isHidden = false
                overlayView.alpha = 1
                blurView.effect = UIBlurEffect(style: .systemThinMaterialDark)
                messageContainer.alpha = 0
            case .hard:
                overlayView.isUserInteractionEnabled = true
                overlayView.isHidden = false
                overlayView.alpha = 1
                blurView.effect = UIBlurEffect(style: .systemChromeMaterialDark)
                messageContainer.alpha = 1
            }
        }

        actionButton.isHidden = !allowReveal
        if allowReveal {
            actionButton.setTitle("Tap to Reveal", for: .normal)
        } else {
            actionButton.setTitle("Ask Parent", for: .normal)
        }

        if animated {
            UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState]) {
                changes()
            } completion: { _ in
                if mode == .hidden {
                    overlayView.isHidden = true
                }
            }
        } else {
            changes()
            if mode == .hidden {
                overlayView.isHidden = true
            }
        }
    }

    @objc private func didTapActionButton() {
        guard allowReveal else { return }
        onRevealTap?()
    }
}
